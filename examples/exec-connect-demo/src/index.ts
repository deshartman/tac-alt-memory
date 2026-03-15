#!/usr/bin/env node

/**
 * TAC Exec Connect Demo - Executable Example
 *
 * A complete multi-channel demo showing how to:
 * 1. Set up TAC with SMS and Voice channels
 * 2. Process webhooks from Twilio (SMS and Voice)
 * 3. Retrieve memories and context
 * 4. Process messages with LLM (OpenAI Agents SDK)
 * 5. Send responses back through SMS and Voice
 * 6. Handle WebSocket connections for Voice streaming
 *
 * This demo demonstrates TAC's channel-agnostic architecture with both SMS and Voice support.
 */

import { config } from 'dotenv';
import {
  TAC,
  TACConfig,
  TACServer,
  SMSChannel,
  VoiceChannel,
  ConversationId,
  handleFlexHandoffLogic,
  ConversationRelayCallbackPayload,
} from 'twilio-agent-connect';
import { LLMService } from './llm-service';
import { dashboardHandler, startDashboardServer } from './dashboard';
import { MemoryPoller } from './services/memory-poller';

// Load environment variables
config();

/**
 * OpenAI ChatCompletion message type (simplified)
 */
interface ChatCompletionMessageParam {
  role: 'user' | 'assistant';
  content: string;
}

async function main(): Promise<void> {
  console.log('🦉 Starting Owl Internet Customer Service Demo...');

  try {
    // Initialize TAC - automatically loads all configuration from environment variables
    const tac = new TAC({ config: TACConfig.fromEnv() });

    // Initialize channels
    const smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);

    // Initialize LLM service
    const llmService = new LLMService(tac);

    // User-managed conversation history
    // Key: conversation_id, Value: list of messages
    const conversationMessages = new Map<string, ChatCompletionMessageParam[]>();

    // Track active pollers (one per profile)
    const activePollers = new Map<string, MemoryPoller>();

    // Register message ready callback
    tac.onMessageReady(
      async ({ message: userMessage, session: context, memory: _memoryResponse }) => {
        // Cast to ConversationId branded type for channel methods
        const convId = context.conversation_id as ConversationId;

        try {
          // Initialize conversation history if needed
          if (!conversationMessages.has(convId)) {
            conversationMessages.set(convId, []);
          }

          const history = conversationMessages.get(convId)!;

          // Add current user message
          history.push({
            role: 'user',
            content: userMessage,
          });

          // Log incoming message with clear separator
          console.log(
            `\n${'='.repeat(80)}\nUSER MESSAGE | ${userMessage.substring(0, 50)}${
              userMessage.length > 50 ? '...' : ''
            }`
          );
          console.log(`Conversation ID: ${convId}`);
          console.log(`Channel: ${context.channel}`);
          console.log(`Profile ID: ${context.profile_id || 'N/A'}`);

          // Dashboard: user message event
          dashboardHandler.pushEvent({
            event_type: 'user_message',
            conversation_id: convId,
            channel: context.channel,
            ...(context.profile_id && { profile_id: context.profile_id }),
            message: userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''),
          });

          // Start memory polling if enabled and not already running
          if (
            context.profile_id &&
            tac.isMemoryEnabled() &&
            !activePollers.has(context.profile_id) &&
            process.env.MEMORY_POLLING_ENABLED !== 'false'
          ) {
            const poller = new MemoryPoller(
              tac,
              context.profile_id,
              Number(process.env.MEMORY_POLL_INTERVAL_MS) || 1500,
              dashboardHandler
            );
            await poller.start();
            activePollers.set(context.profile_id, poller);
          }

          // Get the active websocket for this conversation if it's a voice channel
          const activeWebsocket =
            context.channel === 'voice' ? voiceChannel.getWebsocket(convId) : null;

          // Process message with LLM
          console.log('AI AGENT | Processing message...');

          // Dashboard: ai_processing event
          dashboardHandler.pushEvent({
            event_type: 'ai_processing',
            conversation_id: convId,
            channel: context.channel,
            message: 'Processing message...',
          });

          // LLM retrieves memory via tools - don't pre-inject it
          const llmResponse = await llmService.processMessage(
            userMessage,
            null, // Force LLM to use retrieve_profile/retrieve_memory tools
            context,
            activeWebsocket,
            history
          );

          // Send response through appropriate channel
          if (llmResponse) {
            if (context.channel === 'voice') {
              await voiceChannel.sendResponse(convId, llmResponse);
            } else {
              await smsChannel.sendResponse(convId, llmResponse);
            }

            // Log response with preview
            const responsePreview =
              llmResponse.length > 100 ? llmResponse.substring(0, 100) + '...' : llmResponse;
            console.log(`AI RESPONSE | ${responsePreview}`);

            // Dashboard: ai_response event
            dashboardHandler.pushEvent({
              event_type: 'ai_response',
              conversation_id: convId,
              channel: context.channel,
              ...(context.profile_id && { profile_id: context.profile_id }),
              message: responsePreview,
            });

            // After successful AI response, create observation if applicable
            if (context.profile_id && tac.isMemoryEnabled()) {
              try {
                const memoryClient = tac.getMemoryClient();
                const observation = llmService.extractKeyLearning(
                  userMessage,
                  llmResponse,
                  context
                );

                if (observation && memoryClient) {
                  await memoryClient.createObservation(
                    tac.getConfig().memoryStoreId!,
                    context.profile_id,
                    observation,
                    'twilio-agent-connect',
                    [convId],
                    new Date().toISOString()
                  );

                  console.log(`OBSERVATION CREATED: ${observation}`);

                  // Dashboard event
                  dashboardHandler.pushEvent({
                    event_type: 'observation_created',
                    conversation_id: convId,
                    channel: context.channel,
                    profile_id: context.profile_id,
                    message: `Created: ${observation.substring(0, 50)}${observation.length > 50 ? '...' : ''}`,
                    metadata: { observation: observation },
                  });
                }
              } catch (error) {
                console.error('Failed to create observation:', error);
                // Don't fail response if observation creation fails
              }
            }

            // Check if there's a pending handoff in session metadata
            if (context.metadata && 'pending_handoff' in context.metadata) {
              const pendingHandoff = context.metadata.pending_handoff as { handoff_data?: string };
              const handoffDataJson = pendingHandoff.handoff_data;

              if (context.channel === 'voice' && handoffDataJson && activeWebsocket) {
                try {
                  console.log(`\n${'='.repeat(80)}\nHANDOFF | Transferring to human agent...`);

                  // Dashboard: handoff event
                  dashboardHandler.pushEvent({
                    event_type: 'handoff',
                    conversation_id: convId,
                    channel: context.channel,
                    message: 'Transferring to human agent...',
                  });

                  activeWebsocket.send(
                    JSON.stringify({ type: 'end', handoffData: handoffDataJson })
                  );
                  // Clear the metadata after processing
                  delete context.metadata.pending_handoff;
                } catch (error) {
                  console.error('Handoff failed:', error);
                }
              }
            }

            // Store assistant response in history
            history.push({
              role: 'assistant',
              content: llmResponse,
            });
          }
        } catch (error) {
          console.error('Error processing message:', error);

          // Dashboard: error event
          dashboardHandler.pushEvent({
            event_type: 'error',
            conversation_id: convId,
            channel: context.channel,
            message: error instanceof Error ? error.message : 'Unknown error',
          });

          // Send error response manually
          const errorMessage = "I'm experiencing technical difficulties. Please try again.";
          if (context.channel === 'voice') {
            await voiceChannel.sendResponse(convId, errorMessage);
          } else {
            await smsChannel.sendResponse(convId, errorMessage);
          }
        }
      }
    );

    // Handle handoffs
    tac.onHandoff(({ conversationId, reason }) => {
      console.log(`🤝 Handoff requested for ${conversationId}`);
      console.log(`Reason: ${reason || 'N/A'}`);
      // In a real implementation, integrate with your support system
      // For demo, we'll just log it
    });

    // Create Flex handoff handler
    const handoffHandler = (payload: ConversationRelayCallbackPayload): Promise<string> => {
      console.log(`FLEX HANDOFF | Processing handoff for call ${payload.CallSid}`);

      const formData: Record<string, string> = {
        HandoffData: payload.HandoffData || '',
        CallStatus: payload.CallStatus,
      };

      const result = handleFlexHandoffLogic(formData, process.env.FLEX_WORKFLOW_SID);

      if (result.success) {
        console.log('FLEX HANDOFF | Generated TwiML to enqueue to Flex workflow');
      } else {
        console.log(`FLEX HANDOFF | Error: ${result.content}`);
      }

      return Promise.resolve(result.content);
    };

    // Create and start server with automatic port retry
    let port = Number(process.env.PORT) || 8000;
    let server: TACServer | null = null;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        server = new TACServer(tac, {
          development: true,
          voice: {
            port,
          },
          conversationRelayConfig: {
            welcomeGreeting: 'Hello! Thank you for calling Owl Internet. How can I help you today?',
          },
          handoffHandler,
        });

        await server.start();
        console.log(`✅ Server started on port ${port}`);
        break; // Success!
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
          console.log(`⚠️  Port ${port} is in use, trying ${port + 1}...`);
          port++;
          server = null;
        } else {
          throw error; // Re-throw non-port-related errors
        }
      }
    }

    if (!server) {
      throw new Error(`Failed to start server after ${maxRetries} attempts`);
    }

    // Start dashboard server
    await startDashboardServer();

    console.log('✅ Owl Internet Customer Service Demo is running!');
    console.log('');
    console.log('📋 Available Channels:');
    console.log('• SMS: Configure webhook to POST http://your-domain.com/sms');
    console.log('• Voice: Configure webhook to POST http://your-domain.com/twiml');
    console.log('');
    console.log('🔧 Available Tools:');
    console.log('• Get available plans');
    console.log('• Look up plan pricing');
    console.log('• Check service outages by zip code');
    console.log('• Run router diagnostics');
    console.log('• Look up available discounts');
    console.log('• Confirm orders via SMS');
    console.log('• Escalate to human agent (voice only)');
    console.log('');
    console.log('💬 Try these example requests:');
    console.log('• "What internet plans do you have?"');
    console.log('• "How much is the 1000 Mbps plan?"');
    console.log('• "Check for outages in 94103"');
    console.log('• "Run diagnostics on my OWL-R2021 router"');
    console.log('• "I need to speak with someone"');

    // Graceful shutdown
    process.on('SIGINT', () => {
      void (async (): Promise<void> => {
        console.log('\n🛑 Shutting down...');

        // Stop all pollers
        for (const poller of activePollers.values()) {
          await poller.stop();
        }

        await server.stop();
        process.exit(0);
      })();
    });
  } catch (error) {
    console.error('❌ Failed to start demo:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the demo
void main();
