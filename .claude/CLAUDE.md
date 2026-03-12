# Twilio Agent Connect - TypeScript Implementation

## Project Overview

This is a complete TypeScript implementation of the Twilio Agent Connect (TAC) - a modern framework for building AI-powered conversational applications that work seamlessly across SMS and Voice channels using Twilio infrastructure.

## Architecture

### Core Packages (npm workspace monorepo)

- **`@twilio/tac-core`** - Core framework with unified type system, TAC class, channels, and all shared types
- **`@twilio/tac-server`** - Fastify-based server with webhook handlers and WebSocket support
- **`@twilio/tac-tools`** - Simple tool system with built-in tools for messaging, memory, and handoff

### Key Design Decisions

1. **Unified Type System**: All types are exported from `@twilio/tac-core` rather than separate packages
2. **Channel Abstraction**: SMS and Voice channels implement the same `Channel` interface
3. **Callback-Based**: Simple callback pattern for message handling, handoffs, and errors (removed EventEmitter complexity)
4. **Tool Integration**: Simplified tool system with direct JSON schema definitions compatible with OpenAI function calling
5. **1:1 Python Parity**: Deliberately simplified to match Python implementation without overengineering

### Channel Implementation

- **SMS Channel**: Direct Twilio webhook processing with TwiML responses
- **Voice Channel**: Bi-directional WebSocket + TwiML for real-time audio streaming
- **Memory Integration**: Automatic conversation context storage and retrieval

## Build System

```bash
npm run build     # Builds all packages in dependency order with cache cleanup
npm run dev       # Development mode with file watching
npm test          # Run tests once (for CI/automation)
npm run test:watch # Run tests in watch mode (for development)
npm run lint      # ESLint code quality checks
npm run format    # Prettier code formatting
npm run typecheck # TypeScript type checking across all packages
```

**Important**: Build script includes `.tsbuildinfo` cleanup to handle TypeScript incremental compilation issues in monorepo setup.

## Examples

### Getting Started (`getting_started/examples/openai/`)
**Recommended starting point** for new users. Production-ready example demonstrating:
- Multi-channel support (SMS and Voice in single application)
- OpenAI GPT-4o-mini integration
- Memory integration for user profiles and conversation history
- Profile personalization with trait groups
- Conversation context management

[→ View Getting Started Guide](../getting_started/README.md)

## Configuration

Required environment variables:
```bash
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
CONVERSATION_SERVICE_ID=your_conversation_service_id
```

Optional environment variables:
```bash
ENVIRONMENT=prod                          # Defaults to 'prod' if not specified
MEMORY_STORE_ID=your_memory_store_id      # For user profiles and conversation history
MEMORY_API_KEY=your_memory_api_key        # Required if using Memory
MEMORY_API_TOKEN=your_memory_api_token    # Required if using Memory
OPENAI_API_KEY=your_openai_key            # For OpenAI examples
VOICE_PUBLIC_DOMAIN=your_ngrok_domain     # Required for voice channel
```

Webhook configuration in Twilio Console:
- **Phone Number SMS webhook**: Not needed. Leave blank or point to an unrelated endpoint.
- **Phone Number Voice webhook**: `POST https://your-domain.com/twiml`
- **Conversations Service webhook**: `POST https://your-domain.com/conversation`

> **Note:** The `/conversation` endpoint routes events to the correct channel (SMS/Voice) based on the payload's `data.author.channel` field.

### Pull Requests
When creating PRs, read and fill in the template at `.github/PULL_REQUEST_TEMPLATE.md`.

## Development Notes

### Simplification and Parity Achievement
- **Removed overengineering**: Eliminated complex tool registry, EventEmitter patterns, and middleware systems not present in Python implementation
- **1:1 Python parity**: Successfully simplified to match Python TAC functionality without sacrificing capability
- **Callback-based architecture**: Replaced EventEmitter with simple callback patterns for better clarity and performance
- **Direct JSON schemas**: Simplified tool definitions using direct JSON schema objects instead of wrapper classes

### Type System Migration Completed
- Migrated from separate `@twilio/tac-types` package to unified exports from `@twilio/tac-core`
- All imports now use: `import { TypeName } from '@twilio/tac-core'`
- Build system handles dependency ordering automatically

### Testing and CI/CD
- **Comprehensive test suite**: 47 tests using vitest covering TAC core, channels, configuration, tools, and integration
- **Buildkite CI/CD pipeline**: Automated linting, type checking, and testing across Node.js 20 and 22
- **Test coverage**: Focus on happy paths with proper Twilio SID validation and async callback handling
- **Quality gates**: ESLint, Prettier, and TypeScript strict mode ensure code quality

### Known Compatibility Issues
- Fastify plugin types require `as any` casting due to TypeProvider differences
- WebSocket connections need type casting between Fastify and ws library types
- Uses `noEmitOnError: false` in TypeScript config for development flexibility

## Future Development Areas

1. **Enhanced Tool System**: More built-in tools for common use cases
2. **Advanced Memory**: Semantic search and conversation summarization
3. **Analytics**: Call metrics, conversation insights, performance monitoring
4. **Additional Channels**: WhatsApp, Facebook Messenger, etc.
5. **Voice Improvements**: Better interrupt handling, streaming responses
6. **Enterprise Features**: Multi-tenancy, advanced security, compliance tools

## Technical Stack

- **TypeScript 5.x** with strict mode
- **Fastify** for high-performance HTTP server
- **WebSocket (ws)** for real-time voice communication
- **Zod** for runtime schema validation
- **Twilio SDK** for platform integration
- **OpenAI** for AI capabilities (in examples)
- **Vitest** for testing framework with 47 comprehensive tests
- **ESLint + Prettier** for code quality and formatting
- **Buildkite** for CI/CD pipeline automation
- **tsup** for optimized TypeScript bundling

## Repository Status

This repository contains a **complete, scaffolded implementation** ready for:
- **Production deployment** (with proper environment setup)
- **Extension with custom tools and capabilities**
- **Integration into existing Twilio applications**
- **Use as a foundation for AI-powered customer service systems**

### Scaffolding Complete
- **Core framework**: Simplified to 1:1 Python parity
- **Test suite**: 47 comprehensive tests with vitest
- **CI/CD pipeline**: Buildkite automation with linting and testing
- **Code quality**: ESLint, Prettier, and TypeScript strict mode
- **Documentation**: Complete development and usage guides
- **Examples**: Multiple working examples for different use cases

The framework is designed to be both simple enough for quick prototypes and robust enough for production use cases. Ready for immediate development and deployment.
