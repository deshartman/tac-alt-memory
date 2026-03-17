# Plan: Fix Test Failures from Segment ProfileService Integration

## Summary
**Status**: 11 tests failing (207/218 passing)
**Root Cause**: Tests expect old MemoryClient initialization behavior
**Branch**: feature/external-memory
**Commit**: Merge completed (391913d)

---

## Problem Analysis

### Architecture Change (commit cf3f61b)
The Segment ProfileService integration changed MemoryClient initialization logic:

**Old Behavior (before Segment integration)**:
```typescript
if (this.config.memoryStoreId) {
  this.memoryClient = new MemoryClient(this.config, this.logger);
}
```

**New Behavior (with ProfileService abstraction)**:
```typescript
// Only initialize MemoryClient if using Memora as profile provider
if (this.config.profileServiceProvider === 'memora' && this.config.memoryStoreId) {
  this.memoryClient = new MemoryClient(this.config, this.logger);
}
```

### Impact on Tests
Tests create configs with `memoryStoreId` but don't set `profileServiceProvider`, causing:
1. `tac.isMemoryEnabled()` → returns `false` (expects `true`)
2. `tac.getMemoryClient()` → returns `undefined` (expects MemoryClient instance)
3. Cannot spy on MemoryClient methods → "spyOn could not find an object to spy upon"

---

## Failing Tests Breakdown

### File: tests/tac.test.ts (1 failure)
**Test**: "should initialize memory client when memoryStoreId is provided" (line 79-88)
```typescript
it('should initialize memory client when memoryStoreId is provided', () => {
  const configWithMemory = {
    ...getTestConfig(),
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
  };
  const config = new TACConfig(configWithMemory);
  const tac = new TAC({ config });

  expect(tac.getMemoryClient()).toBeDefined(); // FAILS - returns undefined
});
```

**Fix Required**: Add `profileServiceProvider: 'memora'` to config

---

### File: tests/memory.test.ts (10 failures)

#### Test 1: "isMemoryEnabled() should return true when memory configured" (line 29-35)
```typescript
expect(tac.isMemoryEnabled()).toBe(true); // FAILS - returns false
```
**Fix**: Add `profileServiceProvider: 'memora'` to `getTestConfigWithMemory()`

#### Tests 2-3: "retrieveMemory() with profile_id" / "auto-lookup profile" (lines 45-134)
```typescript
const memoryClient = tac.getMemoryClient();
expect(memoryClient).toBeDefined(); // FAILS - undefined
vi.spyOn(memoryClient!, 'retrieveMemories').mockResolvedValue(...);
```
**Fix**: Same as above - enables MemoryClient initialization

#### Tests 4-7: Mock spy failures (lines 163-280)
```typescript
Error: spyOn could not find an object to spy upon
```
**Affected methods**: `lookupProfile`, `getProfile`
**Fix**: Same as above

#### Tests 8-9: Wrong error messages (lines 205-242)
```typescript
// Expected: 'profile_id is required for memory ret…'
// Received: 'Failed to list communications: 401 Un…'
```
**Analysis**: Tests reach Twilio API call instead of validation error because MemoryClient is undefined
**Fix**: Same as above - proper initialization will trigger validation errors

#### Tests 10-11: "fetchProfile()" tests (lines 433-489)
```typescript
vi.spyOn(memoryClient!, 'getProfile').mockResolvedValue(...); // FAILS - undefined
```
**Fix**: Same as above

---

## Solution: Minimal Changes to Test Configurations

### Change 1: tests/tac.test.ts
**Location**: Line 79-88
**Before**:
```typescript
it('should initialize memory client when memoryStoreId is provided', () => {
  const configWithMemory = {
    ...getTestConfig(),
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
  };
  const config = new TACConfig(configWithMemory);
  const tac = new TAC({ config });

  expect(tac.getMemoryClient()).toBeDefined();
});
```

**After**:
```typescript
it('should initialize memory client when memoryStoreId is provided', () => {
  const configWithMemory = {
    ...getTestConfig(),
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
    profileServiceProvider: 'memora' as const,  // NEW LINE
  };
  const config = new TACConfig(configWithMemory);
  const tac = new TAC({ config });

  expect(tac.getMemoryClient()).toBeDefined();
});
```

### Change 2: tests/memory.test.ts
**Location**: Line 23-26
**Before**:
```typescript
const getTestConfigWithMemory = () => ({
  ...getTestConfigWithoutMemory(),
  memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
});
```

**After**:
```typescript
const getTestConfigWithMemory = () => ({
  ...getTestConfigWithoutMemory(),
  memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
  profileServiceProvider: 'memora' as const,  // NEW LINE
});
```

**Impact**: Fixes all 10 failing tests in memory.test.ts by enabling MemoryClient initialization

---

## Bonus Issue: examples/multi-channel-demo TypeScript Errors

### Error 1: TACTool import (line 21)
```typescript
error TS2305: Module '"@twilio/tac-core"' has no exported member 'TACTool'.
```
**Fix**: Change import to use `@twilio/tac-tools` package or remove if unused

### Errors 2-3: ChatCompletionMessageToolCall.function (lines 294, 298)
```typescript
error TS2339: Property 'function' does not exist on type 'ChatCompletionMessageToolCall'.
```
**Analysis**: OpenAI SDK type changes or incorrect usage
**Decision**: Mark example as deprecated/unmaintained or fix types

---

## Implementation Checklist

### Phase 1: Fix Test Configurations
- [ ] Update tests/tac.test.ts line 82 to add `profileServiceProvider: 'memora'`
- [ ] Update tests/memory.test.ts line 24 to add `profileServiceProvider: 'memora'`

### Phase 2: Verify Tests Pass
- [ ] Run: `npm test`
- [ ] Expected: 218/218 tests passing (all 11 failures resolved)

### Phase 3: Fix TypeScript Errors (Optional)
- [ ] Investigate examples/multi-channel-demo TACTool import
- [ ] Fix or deprecate multi-channel-demo example

### Phase 4: Pre-Commit Checks
- [ ] `npm run format:check` - Should pass (no code changes)
- [ ] `npm run lint` - Should pass (14 warnings pre-existing)
- [ ] `npm run typecheck` - Will pass after multi-channel-demo fix
- [ ] `npm test` - All 218 tests passing

### Phase 5: Commit
- [ ] Commit message: "test: Fix test configs for Memora ProfileService provider"
- [ ] Body: Explain profileServiceProvider requirement

---

## Expected Outcome

**Before**:
```
 Test Files  2 failed | 12 passed (14)
      Tests  11 failed | 207 passed (218)
```

**After**:
```
 Test Files  14 passed (14)
      Tests  218 passed (218)
```

**TypeCheck**: Will still fail until multi-channel-demo is fixed/removed

---

## Notes

1. **Minimal changes**: Only 2 lines added across 2 test files
2. **No logic changes**: Tests remain functionally identical
3. **Backward compatibility**: Tests work for both Memora and Segment modes
4. **Multi-channel-demo**: Separate issue, not blocking test fixes
