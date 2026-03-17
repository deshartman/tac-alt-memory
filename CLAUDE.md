# Twilio Agent Connect - TypeScript SDK

A TypeScript framework for building AI-powered conversational agents on Twilio infrastructure. Provides channel abstractions (SMS, Voice), tool integration, memory/knowledge APIs, and a production-ready Fastify server — designed for 1:1 parity with the [Python SDK](https://github.com/twilio-innovation/twilio-agent-connect-python).

## Development Commands

```bash
npm run build          # Build all packages (tsup)
npm run clean          # Remove dist/ directories
npm run test           # Run tests once (vitest --run)
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with v8 coverage
npm run lint           # ESLint check
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier format
npm run format:check   # Prettier check only
npm run typecheck      # tsc --noEmit
```

## Package Structure

```
packages/
  core/        # Central framework: TAC orchestrator, channels (SMS/Voice),
               #   API clients (Memory, Conversation, Knowledge), config, types
  tools/       # Tool system: TACTool class, defineTool(), built-in tools
               #   (memory, messaging, handoff, knowledge)
  server/      # TACServer: Fastify wrapper with webhook + WebSocket handlers
src/
  index.ts     # Root re-export of all three packages (single entry point)
tests/         # Vitest test suite
getting_started/  # Example apps (OpenAI integration)
```

## Architecture

### Key Design Decisions

1. **Unified Type System**: All types are exported from `@twilio/tac-core` rather than separate packages
2. **Channel Abstraction**: SMS and Voice channels implement the same `Channel` interface
3. **Callback-Based**: Simple callback pattern for message handling, handoffs, and errors
4. **Tool Integration**: Simplified tool system with direct JSON schema definitions compatible with OpenAI function calling
5. **1:1 Python Parity**: Deliberately simplified to match Python implementation without overengineering

### Channel Implementation

- **SMS Channel**: Processes Conversations Configuration webhooks via `/conversation` endpoint; sends responses via Twilio Messages API
- **Voice Channel**: Bi-directional WebSocket + TwiML for real-time audio streaming via `/conversation` endpoint
- **Memory Integration**: Automatic conversation context storage and retrieval

## Code Conventions

- **TypeScript strict mode** with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Zod** for all runtime validation and type inference (`z.infer<typeof Schema>`)
- **ESM only** (`"type": "module"`) — imports use `.js` extensions in compiled output
- **Prettier**: single quotes, trailing commas (es5), 100 char width, no parens on single arrow params
- **ESLint**: `@typescript-eslint` with type-checking; unused vars prefixed `_` are allowed; explicit return types warned
- **Naming**: PascalCase classes, camelCase functions/variables
- **Logging**: Pino with hierarchical child loggers tagged by component
- **Unused parameters**: Prefix with `_` to indicate intentionally unused parameters that must remain for API compatibility
  ```typescript
  // Example: Parameter required by interface but not used in this implementation
  async processMessage(
    userMessage: string,
    _memoryResponse: TACMemoryResponse | null,  // Not used - memory retrieved via tools
    context: ConversationSession
  ): Promise<string> { ... }
  ```

## Key Architecture

- **TAC class** (`packages/core/src/lib/tac.ts`): Central orchestrator managing config, channels, callbacks, and API clients
- **Channel abstraction** (`packages/core/src/channels/base.ts`): `BaseChannel` abstract base class extended by `SMSChannel` (webhooks/TwiML) and `VoiceChannel` (WebSocket)
- **Callback pattern**: Simple callbacks (`onMessageReady`, `onInterrupt`, `onHandoff`, `onConversationEnded`) instead of EventEmitter
- **Tool system** (`packages/tools/src/lib/builder.ts`): `defineTool()` with JSON schema; supports conversion to OpenAI and Anthropic formats
- **Config via Zod** (`packages/core/src/lib/config.ts`): `TACConfig.fromEnv()` validates env vars; environment-aware API URL computation (dev/stage/prod)
- **API credentials consolidated** at `TACConfig` level (apiKey/apiToken shared across Memory, Conversation, Knowledge clients)
- **TACServer** (`packages/server/src/lib/server.ts`): Fastify-based server with default `welcomeGreeting` for voice calls; customizable via `conversationRelayConfig`

## Dependencies

**Runtime**: twilio, fastify, @fastify/websocket, @fastify/formbody, ws, zod, pino, pino-pretty, dotenv, fastify-graceful-shutdown
**Dev**: typescript, tsup, vitest, @vitest/coverage-v8, eslint, prettier, rimraf, @types/node, @types/ws

## Configuration

### Required Environment Variables
```bash
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
CONVERSATION_SERVICE_ID=your_conversation_service_id
TWILIO_API_KEY=your_api_key               # Required by TACConfig
TWILIO_API_TOKEN=your_api_token           # Required by TACConfig
```

### Optional Environment Variables
```bash
ENVIRONMENT=prod                          # Defaults to 'prod' if not specified
MEMORY_STORE_ID=your_memory_store_id      # For user profiles and conversation history
OPENAI_API_KEY=your_openai_key            # For OpenAI examples
VOICE_PUBLIC_DOMAIN=your_ngrok_domain     # Required for voice channel
```

### Webhook Configuration in Twilio Console
- **Phone Number SMS webhook**: Not needed. Leave blank or point to an unrelated endpoint.
- **Phone Number Voice webhook**: `POST https://your-domain.com/twiml`
- **Conversations Configuration webhook**: `POST https://your-domain.com/conversation`

> **Note:** The `/conversation` endpoint routes events to the correct channel (SMS/Voice) based on the payload's `data.author.channel` field.

## TACServer Configuration

The `TACServer` class (`packages/server/src/lib/server.ts`) provides a production-ready Fastify server with sensible defaults:

### Default Configuration

```typescript
{
  voice: { host: '0.0.0.0', port: 3000 },
  webhookPaths: {
    twiml: '/twiml',
    ws: '/ws',
    conversation: '/conversation',
    conversationRelayCallback: '/conversation-relay-callback',
  },
  conversationRelayConfig: {
    welcomeGreeting: 'Hello! How can I assist you today?',
  },
  development: false,
  validateWebhooks: true,
}
```

### Customizing Voice Greeting

The default `welcomeGreeting` is automatically applied to all voice calls. Customize it via `conversationRelayConfig`:

```typescript
const server = new TACServer(tac, {
  conversationRelayConfig: {
    welcomeGreeting: 'Welcome to our support line!',
    welcomeGreetingInterruptible: 'any',
    transcriptionProvider: 'Deepgram',
    ttsProvider: 'Google',
  },
});
```

All ConversationRelay attributes except `url` are supported (see `packages/core/src/types/crelay.ts`). The `url` field is automatically set by the server based on the request host and WebSocket path.

## Examples

### Getting Started (`getting_started/examples/openai/`)
**Recommended starting point** for new users. Production-ready example demonstrating:
- Multi-channel support (SMS and Voice in single application)
- OpenAI GPT-4o-mini integration
- Memory integration for user profiles and conversation history
- Profile personalization with trait groups
- Conversation context management

See [getting_started/README.md](getting_started/README.md) for detailed setup instructions.

## Pull Requests

When creating PRs, read and fill in `.github/PULL_REQUEST_TEMPLATE.md`.
