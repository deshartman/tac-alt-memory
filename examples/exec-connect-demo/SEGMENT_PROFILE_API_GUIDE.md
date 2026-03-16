# Segment Profile API Integration Guide

This document explains how to integrate Segment Profile API with TAC for customer data management.

## Quick Start

### 1. Find Your Segment Space ID

The Space ID is required for Profile API access.

**Steps:**
1. Log into [Segment](https://app.segment.com/)
2. In the left sidebar, click **Unify**
3. Click **Unify settings** at the bottom of the Unify section
4. Click the **API access** tab at the top
5. Look for the text: **"Use the following space ID to access the Profile API:"**
6. Copy the space ID shown (format: `spa_xxxxxxxxxxxxxxxxxx`)

**Important:**
- Space ID **starts with `spa_`** (e.g., `spa_hvakucpPfsY4mZ18GCmVmf`)
- Found in **Unify > Unify settings > API access** tab
- Different from Workspace ID
- Same page shows your Unify API access tokens below

![Space ID Location](./images/segment-space-id-location.png)

### 2. Create Unify API Access Token

The Unify token authenticates Profile API requests. This token is created on the **same page** as the Space ID.

**Steps:**
1. On the same **Unify > Unify settings > API access** page (from Step 1 above)
2. Scroll down to the **tokens table** (shows Token Name, Token ID, Created On)
3. Click **"Create API Access Token"** button
4. Name it (e.g., `TAC Profile API` or `TAC-Segment`)
5. Select appropriate access level
6. Click **"Create"**
7. **Copy the full token immediately** (you won't be able to see it again)
8. The token will appear in the table with just its ID (e.g., `70d938`)

This token is used with **Basic Auth** format:
```
Authorization: Basic base64(token:)
```

### 3. Configure Environment Variables

```bash
# Required for Segment Profile API
PROFILE_SERVICE_PROVIDER=segment
SEGMENT_WRITE_KEY=xxxxxxxxxx                # From Sources > Settings > API Keys
SEGMENT_SPACE_ID=spa_xxxxxxxxxxxxxxxxxx     # From Unify > Settings > General
SEGMENT_UNIFY_TOKEN=xxxxxxxxxxxxxxxxxx      # From Unify > Settings > API Access

# Optional - Public API token for workspace management
SEGMENT_ACCESS_TOKEN=sgp_xxxxxxxxxx         # From Settings > Access Management > Tokens
```

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     LLM Tool Calls                           │
│  retrieve_profile / update_profile / store_memory            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  CustomerStateStore (SQLite)                 │
│  • Immediate read-after-write consistency                    │
│  • Application-specific CRM data (plan, preferences)         │
│  • File: ./customer-state.db                                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ (async, non-blocking)
┌─────────────────────────────────────────────────────────────┐
│                  Segment Profile API                         │
│  • Eventual consistency (few seconds delay)                  │
│  • Unified customer profiles                                 │
│  • Analytics and dashboards                                  │
└─────────────────────────────────────────────────────────────┘
```

### Why Hybrid Storage?

1. **SQLite (CustomerStateStore)**
   - ✅ Instant reads after writes
   - ✅ Application-specific schema
   - ✅ No network latency
   - ✅ Different apps can have different structures

2. **Segment**
   - ✅ Unified profiles across all touchpoints
   - ✅ Analytics dashboards
   - ✅ Integration with other tools
   - ⚠️ Eventual consistency (few seconds delay)

## API Details

### Segment Profile API Endpoints

**Read Traits (GET):**
```
GET https://profiles.segment.com/v1/spaces/{spaceId}/collections/users/profiles/user_id:{userId}/traits
Authorization: Basic base64(unifyToken:)
```

**Write Traits (Events API):**
```javascript
analytics.identify({
  userId: 'phone_+1234567890',
  traits: { plan: 'standard', name: 'John' }
});
```

### Authentication

| API | Method | Header Format |
|-----|--------|---------------|
| **Profile API (Read)** | GET | `Authorization: Basic base64(SEGMENT_UNIFY_TOKEN:)` |
| **Events API (Write)** | identify() | Uses SEGMENT_WRITE_KEY (handled by SDK) |

**Important:**
- Profile API uses Basic Auth with empty password: `base64(token:)`
- Events API uses Write Key (handled by @segment/analytics-node SDK)
- Two different authentication methods for read vs write

## Code Implementation

### Tool Implementation

```typescript
// retrieve_profile - Reads from SQLite first, Segment as fallback
export function createRetrieveProfileTool(context) {
  return tool({
    execute: async (input) => {
      // 1. Read from CustomerStateStore (instant)
      const crmData = await context.customerState.getState(context.phone);

      // 2. Optionally merge with Segment (eventual consistency)
      if (context.profileService) {
        const segmentTraits = await context.profileService.getProfile(context.phone);
        return { ...segmentTraits, ...crmData }; // CRM takes precedence
      }

      return crmData;
    }
  });
}

// update_profile - Writes to SQLite immediately, syncs to Segment async
export function createUpdateProfileTool(context) {
  return tool({
    execute: async (input) => {
      const traits = JSON.parse(input.traits_json);

      // 1. Write to SQLite (instant, blocking)
      await context.customerState.updateState(context.phone, traits);

      // 2. Sync to Segment (async, non-blocking if fails)
      if (context.profileService) {
        try {
          await context.profileService.updateProfile(context.phone, traits);
        } catch (error) {
          console.log('Segment sync failed (non-blocking)', error);
        }
      }

      return { success: true };
    }
  });
}
```

### Profile Service Implementation

```typescript
// SegmentProfileService - Uses Basic Auth for reads, Events API for writes
export class SegmentProfileService {
  async getProfile(phone: string): Promise<Record<string, unknown>> {
    const userId = `phone_${phone}`;
    const url = `https://profiles.segment.com/v1/spaces/${this.spaceId}/collections/users/profiles/user_id:${userId}/traits`;

    // Use Basic Auth with Unify token
    const auth = Buffer.from(`${this.unifyToken}:`).toString('base64');
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` }
    });

    const data = await response.json();
    return data.traits || {};
  }

  async updateProfile(phone: string, traits: Record<string, unknown>): Promise<void> {
    const userId = `phone_${phone}`;

    // Use Events API (identify) via Analytics SDK
    return new Promise((resolve, reject) => {
      this.analytics.identify({
        userId,
        traits: { ...traits, phone }
      }, err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
```

## Troubleshooting

### 401 Unauthorized on Profile API

**Symptoms:**
- `Profile API error: 401 Unauthorized`
- retrieve_profile returns empty traits

**Causes:**
1. Incorrect SEGMENT_UNIFY_TOKEN
2. Token doesn't have Profile API access
3. Using wrong token (Public API token instead of Unify token)

**Solution:**
1. Verify you're using **Unify API Access Token** (from Unify > Settings > API Access)
2. NOT the Public API token (from Settings > Tokens)
3. Create new token if needed

### 405 Method Not Allowed on Profile API

**Symptoms:**
- `Profile API error: 405 Method Not Allowed`
- update_profile fails

**Cause:**
- Trying to POST directly to Profile API
- Profile API is read-only (GET only)

**Solution:**
- Already fixed in code - we use Events API (identify) for writes
- Profile API only for reads
- This is expected behavior

### Empty Traits on Immediate Read

**Symptoms:**
- Write succeeds but immediate read returns empty
- Data appears after a few seconds

**Cause:**
- Segment Profile API has eventual consistency
- Takes few seconds for data to sync

**Solution:**
- Already fixed with CustomerStateStore
- SQLite provides immediate consistency
- Segment syncs in background

### Wrong Space ID Format

**Symptoms:**
- `Profile API error: invalid space id`

**Cause:**
- Using Workspace ID instead of Space ID
- Missing `spa_` prefix

**Solution:**
1. Space ID must start with `spa_`
2. Find in **Unify > Settings**, not Workspace Settings
3. Format: `spa_xxxxxxxxxxxxxxxxxx`

## Testing

### Test Sequence

1. **Send SMS:** "I'll go with standard plan"
   - Should see: `[TOOL] update_profile called`
   - Should see: `saved to local CRM store`
   - Should see: `synced to Segment`

2. **Send SMS:** "What plan am I on?"
   - Should see: `[TOOL] retrieve_profile called`
   - Should see instant response with plan info
   - No delay, reads from SQLite

3. **Check Databases:**
   ```bash
   # Check CustomerStateStore
   sqlite3 customer-state.db "SELECT * FROM customer_state;"

   # Check VectorMemoryStore
   sqlite3 memories.db "SELECT * FROM memories LIMIT 5;"
   ```

4. **Check Segment (after few seconds):**
   - Go to Segment > Unify > Profiles
   - Search for customer by phone number
   - Verify traits are synced

## Best Practices

1. **Always use CustomerStateStore for CRM data**
   - Plan choices, preferences, account info
   - Anything that needs immediate read-after-write

2. **Use Segment for analytics**
   - Track all customer events
   - Build unified profiles
   - Power dashboards and reports

3. **Use VectorMemoryStore for semantic search**
   - Conversation history
   - Customer issues and resolutions
   - Past preferences and context

4. **Error handling**
   - CustomerStateStore: blocking, must succeed
   - Segment: non-blocking, log and continue if fails
   - VectorMemoryStore: blocking, must succeed

## Migration from Memora

If migrating from Memora to Segment:

```bash
# Old configuration
PROFILE_SERVICE_PROVIDER=memora
MEMORY_STORE_ID=mem_store_xxx

# New configuration
PROFILE_SERVICE_PROVIDER=segment
SEGMENT_WRITE_KEY=xxx
SEGMENT_SPACE_ID=spa_xxx
SEGMENT_UNIFY_TOKEN=xxx
```

**Key differences:**
- Memora: Single source of truth (blocking reads/writes)
- Segment: Hybrid (SQLite for reads, Segment for analytics)
- Memora: 150ms SMS to LLM latency
- Segment: 5ms SMS to LLM latency (97% faster)

## Additional Resources

- [Segment Profile API Docs](https://segment.com/docs/unify/profile-api/) (requires login)
- [Segment Unify Overview](https://segment.com/docs/unify/)
- [TAC Documentation](../../README.md)
