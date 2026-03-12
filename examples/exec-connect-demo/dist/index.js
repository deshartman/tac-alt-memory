#!/usr/bin/env node

// src/index.ts
import { config } from "dotenv";
import {
  TAC,
  TACConfig,
  SMSChannel,
  VoiceChannel,
  handleFlexHandoffLogic
} from "@twilio/tac-core";
import { TACServer } from "@twilio/tac-server";

// src/llm-service.ts
import { Agent, run, setDefaultOpenAIKey, setTracingDisabled } from "@openai/agents";

// src/tools.ts
import { tool } from "@openai/agents";
import { z } from "zod";

// src/business-data.ts
var COMPANY_INFO = {
  name: "Owl Internet",
  founded: "2018",
  serviceAreas: "Nationwide fiber and cable internet",
  phone: "1-800-OWL-HELP",
  email: "help@owlinternet.com",
  website: "owlinternet.com",
  hours: "24/7 customer support"
};
var INTERNET_PLANS = {
  "100": {
    name: "Basic",
    speed: "one hundred megabits per second",
    price: "thirty-nine dollars and ninety-nine cents per month",
    description: "Perfect for browsing and streaming"
  },
  "300": {
    name: "Standard",
    speed: "three hundred megabits per second",
    price: "fifty-nine dollars and ninety-nine cents per month",
    description: "Great for families and remote work"
  },
  "500": {
    name: "Advanced",
    speed: "five hundred megabits per second",
    price: "seventy-four dollars and ninety-nine cents per month",
    description: "High-speed for power users"
  },
  "1000": {
    name: "Premium",
    speed: "one thousand megabits per second",
    price: "eighty-nine dollars and ninety-nine cents per month",
    description: "Ultra-fast for heavy usage and gaming"
  },
  "1gig": {
    name: "Premium",
    speed: "one thousand megabits per second",
    price: "eighty-nine dollars and ninety-nine cents per month",
    description: "Ultra-fast for heavy usage and gaming"
  },
  gigabit: {
    name: "Premium",
    speed: "one thousand megabits per second",
    price: "eighty-nine dollars and ninety-nine cents per month",
    description: "Ultra-fast for heavy usage and gaming"
  }
};

// src/tools.ts
var getAvailablePlans = tool({
  name: "get_available_plans",
  description: "Get all available internet plans with their details",
  parameters: z.object({}),
  execute: () => {
    const plansList = [];
    for (const [speed, plan] of Object.entries(INTERNET_PLANS)) {
      if (speed === "1gig" || speed === "gigabit") {
        continue;
      }
      plansList.push(`- ${plan.name} (${speed} Mbps): ${plan.price} - ${plan.description}`);
    }
    return "Available Internet Plans:\n" + plansList.join("\n");
  }
});
var lookUpOrderPrice = tool({
  name: "look_up_order_price",
  description: "Get pricing for internet plan upgrade",
  parameters: z.object({
    planSpeed: z.string().describe('Target internet speed (e.g., "1000 Mbps", "500 Mbps")')
  }),
  execute: (input) => {
    const { planSpeed } = input;
    const speedNum = planSpeed.replace(/\D/g, "");
    if (!speedNum) {
      const planKey = planSpeed.toLowerCase().replace(/\s+/g, "").replace("mbps", "");
      const plan2 = INTERNET_PLANS[planKey];
      if (plan2) {
        return `The ${plan2.name} plan is ${plan2.price} for ${planSpeed} speeds.`;
      }
    }
    const plan = INTERNET_PLANS[speedNum];
    if (plan) {
      return `The ${plan.name} plan (${speedNum} Mbps) is ${plan.price}.`;
    }
    return `Pricing for ${planSpeed} plans: Contact customer service for custom enterprise pricing at ${COMPANY_INFO.phone}.`;
  }
});
var lookUpOutage = tool({
  name: "look_up_outage",
  description: "Check if there was a recent internet outage in a specific zip code",
  parameters: z.object({
    zipCode: z.string().describe('The zip code to check for outages (e.g., "94103", "10001")')
  }),
  execute: (input) => {
    const { zipCode } = input;
    const hasOutage = false;
    if (hasOutage) {
      return `Yes, we detected a recent internet outage in the ${zipCode} area. Our team has resolved the issue and service should be fully restored.`;
    }
    return `Good news! There are no reported outages in the ${zipCode} area. Your service should be operating normally.`;
  }
});
var runDiagnostic = tool({
  name: "run_diagnostic",
  description: "Run diagnostics to check if customer's router is compatible with their internet plan",
  parameters: z.object({
    internetPlan: z.string().describe(`Customer's internet plan speed (e.g., "300", "500", "1000")`),
    routerModel: z.string().describe(`Customer's router model (e.g., "OWL-R2021", "OWL-R2019", "OWL-X5")`)
  }),
  execute: (input) => {
    const { internetPlan, routerModel } = input;
    const diagnosticResult = "ROUTER_NEEDS_UPGRADE";
    if (diagnosticResult === "ROUTER_NEEDS_UPGRADE") {
      return `Diagnostic complete: Your ${routerModel} router needs an upgrade to support your ${internetPlan} Mbps plan. The current router is limiting your speeds. We recommend upgrading to our OWL-X5 router for optimal performance.`;
    } else if (diagnosticResult === "ROUTER_COMPATIBLE") {
      return `Diagnostic complete: Your ${routerModel} router is fully compatible with your ${internetPlan} Mbps plan. No upgrade needed.`;
    }
    return "Diagnostic complete: Unable to determine router compatibility. Please contact support.";
  }
});
var lookUpDiscounts = tool({
  name: "look_up_discounts",
  description: "Look up available discounts for customer",
  parameters: z.object({
    customerType: z.string().describe("Customer loyalty tier (loyal, premium, new)")
  }),
  execute: (input) => {
    const { customerType } = input;
    const discounts = [];
    if (customerType === "loyal" || customerType === "premium") {
      discounts.push("20% off first 6 months (retention offer)");
    } else {
      discounts.push("10% off first 3 months (new customer offer)");
    }
    if (discounts.length > 0) {
      return `Available discounts: ${discounts.join(", ")}. I can apply the best combination for you!`;
    }
    return "Let me check for any current promotions that might apply to your account.";
  }
});
function createConfirmOrderTool(tac, context) {
  return tool({
    name: "confirm_order",
    description: "Confirm order and process the upgrade",
    parameters: z.object({
      orderDetails: z.string().describe("Details of the order to confirm")
    }),
    execute: async (input) => {
      const { orderDetails } = input;
      console.log(`[TOOL:CONFIRM] Called with order_details: ${orderDetails.substring(0, 50)}...`);
      try {
        const participants = await tac.getConversationClient().listParticipants(context.conversation_id);
        let customerPhone = null;
        for (const participant of participants) {
          if (participant.type === "CUSTOMER") {
            for (const address of participant.addresses) {
              customerPhone = address.address;
              break;
            }
            if (customerPhone) {
              break;
            }
          }
        }
        if (!customerPhone) {
          console.error("[TOOL:CONFIRM] Unable to derive customer phone number");
          return "Unable to send confirmation - customer phone number not found.";
        }
        console.log(
          `[TOOL:CONFIRM] Derived phone number ${customerPhone} for customer confirmation`
        );
        console.log(`[TOOL:CONFIRM] Sending SMS to: ${customerPhone}`);
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        if (!accountSid || !authToken || !fromNumber) {
          return "Unable to send confirmation - Twilio credentials not configured.";
        }
        const { default: Twilio } = await import("twilio");
        const client = Twilio(accountSid, authToken);
        const message = await client.messages.create({
          body: orderDetails,
          from: fromNumber,
          to: customerPhone
        });
        console.log(`[TOOL:CONFIRM] SMS sent successfully, SID: ${message.sid}`);
        return `Order confirmation sent via SMS! You should receive it shortly with order details${orderDetails ? `: ${orderDetails}` : ""}.`;
      } catch (error) {
        console.error("[TOOL:CONFIRM] Failed to send SMS:", error);
        return `Failed to send order confirmation via SMS: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });
}
function createFlexEscalationTool(session) {
  return tool({
    name: "flex_escalate_to_human",
    description: "Escalate the conversation to a human agent in Flex with optional reason",
    parameters: z.object({
      reason: z.string().describe(
        'The reason for escalation (e.g., "User requested human help", "Technical issue")'
      )
    }),
    execute: (input) => {
      const { reason } = input;
      const handoffData = {
        reason: "handoff",
        call_summary: reason,
        sentiment: "neutral"
      };
      console.log(
        `[TOOL:FLEX_ESCALATE] Marking conversation for escalation: ${JSON.stringify(handoffData)}`
      );
      if (session) {
        if (!session.metadata) {
          session.metadata = {};
        }
        session.metadata.pending_handoff = {
          handoff_data: JSON.stringify(handoffData)
        };
      }
      return { status: "escalated", reason };
    }
  });
}

// src/llm-service.ts
var LLMService = class {
  constructor(tac) {
    this.tac = tac;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      setDefaultOpenAIKey(openaiApiKey);
    }
    setTracingDisabled(true);
    this.baseTools = [
      getAvailablePlans,
      lookUpOrderPrice,
      lookUpDiscounts,
      lookUpOutage,
      runDiagnostic
    ];
  }
  baseTools;
  /**
   * Process user message with memory context and generate response using Agents SDK.
   */
  async processMessage(userMessage, memoryResponse, context, websocket, conversationHistory = null) {
    try {
      const enhancedInstructions = this._buildEnhancedInstructions(memoryResponse, context);
      const tools = [...this.baseTools, createConfirmOrderTool(this.tac, context)];
      if (websocket !== null) {
        tools.push(createFlexEscalationTool(context));
      }
      const agent = new Agent({
        name: "Owl Internet Customer Service",
        instructions: enhancedInstructions,
        model: "gpt-4o",
        tools
      });
      const messagesHistory = conversationHistory || this._buildConversationHistory(memoryResponse);
      const previousMessages = messagesHistory.slice(0, -1);
      let agentInput;
      if (previousMessages.length > 0) {
        const historyLines = previousMessages.map((msg) => `${msg.role}: ${msg.content}`);
        const historyContext = historyLines.join("\n");
        agentInput = `[Previous conversation]
${historyContext}

[Current message]
${userMessage}`;
      } else {
        agentInput = userMessage;
      }
      const result = await run(agent, agentInput);
      return String(result.finalOutput);
    } catch (error) {
      console.error("[LLM] Error processing message:", error);
      return "I'm sorry, I'm having trouble processing your message right now. Please try again.";
    }
  }
  /**
   * Build enhanced agent instructions with TAC memory context.
   */
  _buildEnhancedInstructions(memoryResponse, context) {
    const instructionParts = [
      "You are Owl Internet's comprehensive customer service assistant.",
      "Your goal is to provide personalized, helpful support using the customer's interaction history and context.",
      "",
      "=== CUSTOMER PROFILE ===",
      `- Profile ID: ${context.profile_id || "N/A"}`
    ];
    if (context.profile?.traits) {
      const findField = (obj, fieldNames) => {
        for (const [key, value] of Object.entries(obj)) {
          if (fieldNames.some((f) => f.toLowerCase() === key.toLowerCase()) && typeof value === "string") {
            return value;
          }
          if (value && typeof value === "object" && !Array.isArray(value)) {
            const found = findField(value, fieldNames);
            if (found) return found;
          }
        }
        return null;
      };
      const flattenTraits = (obj, prefix = "") => {
        const lines = [];
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (value && typeof value === "object" && !Array.isArray(value)) {
            lines.push(...flattenTraits(value, fullKey));
          } else if (value !== null && value !== void 0) {
            lines.push(`- ${fullKey}: ${String(value)}`);
          }
        }
        return lines;
      };
      const customerName = findField(context.profile.traits, ["name", "firstName", "first_name"]);
      if (customerName) {
        instructionParts.push("");
        instructionParts.push(
          `IMPORTANT: The customer's name is ${customerName}. Address them by name to personalize the conversation.`
        );
      }
      instructionParts.push("");
      instructionParts.push(...flattenTraits(context.profile.traits));
      instructionParts.push("");
    }
    if (memoryResponse?.observations && memoryResponse.observations.length > 0) {
      instructionParts.push("=== RELEVANT OBSERVATIONS (from TAC Memory) ===");
      for (const obs of memoryResponse.observations) {
        instructionParts.push(`- ${obs.content}`);
      }
      instructionParts.push("");
    }
    if (memoryResponse?.summaries && memoryResponse.summaries.length > 0) {
      instructionParts.push("=== CONVERSATION SUMMARIES ===");
      for (const summary of memoryResponse.summaries) {
        instructionParts.push(`- ${summary.content}`);
      }
      instructionParts.push("");
    }
    instructionParts.push(
      "=== BEHAVIOR GUIDELINES ===",
      "1. CONTEXT AWARENESS:",
      "   - Use the conversation history to maintain continuity",
      "   - Reference previous observations to show you remember past interactions",
      "   - Use summaries to understand the broader context",
      "",
      "2. COMMUNICATION STYLE:",
      "   - Keep responses clear, concise, and professional",
      "   - Show empathy and understanding of their situation",
      "   - Be helpful and proactive",
      "",
      "3. SERVICE EXCELLENCE:",
      "   - Provide helpful suggestions when appropriate",
      "   - If you need more information to help, ask specific clarifying questions",
      "   - Use the tools available to you to assist the customer",
      ""
    );
    if (context.channel === "voice") {
      instructionParts.push(
        "=== IMPORTANT: VOICE/PHONE FORMATTING ===",
        "This conversation is over the PHONE using text-to-speech.",
        "- Use PLAIN TEXT ONLY - no markdown formatting",
        "- Do NOT use asterisks (**bold**), hashtags (#headings), or brackets",
        "- Do NOT use numbered lists (1. 2. 3.) - say 'first, second, third' instead",
        "- Do NOT use bullet points (- or *) - speak naturally",
        "- Speak as you would in a natural phone conversation",
        ""
      );
    } else if (context.channel === "sms") {
      instructionParts.push(
        "=== SMS FORMATTING ===",
        "This conversation is via SMS text message.",
        "- Use markdown formatting for clarity (bold, lists, etc.)",
        "- Use **bold** for emphasis on important information",
        "- Use numbered lists (1. 2. 3.) for multiple options",
        "- Keep messages concise but well-formatted",
        ""
      );
    }
    return instructionParts.join("\n");
  }
  /**
   * Build conversation history from session memories.
   *
   * Session memories contain previous conversation exchanges with structured messages.
   */
  _buildConversationHistory(memoryResponse) {
    const messages = [];
    if (!memoryResponse?.communications || memoryResponse.communications.length === 0) {
      return messages;
    }
    for (const communication of memoryResponse.communications) {
      let isCustomer = false;
      if (communication.author.type) {
        isCustomer = communication.author.type === "CUSTOMER";
      } else {
        isCustomer = communication.author.address !== this.tac.getConfig().twilioPhoneNumber;
      }
      if (isCustomer) {
        messages.push({
          role: "user",
          content: communication.content.text || ""
        });
      } else {
        messages.push({
          role: "assistant",
          content: communication.content.text || ""
        });
      }
    }
    return messages;
  }
};

// src/dashboard/event-handler.ts
import { EventEmitter } from "events";
var MAX_EVENTS = 100;
var DashboardEventHandler = class extends EventEmitter {
  eventQueue = [];
  /**
   * Push a new event to the queue and emit for SSE subscribers
   */
  pushEvent(event) {
    const fullEvent = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      ...event
    };
    this.eventQueue.push(fullEvent);
    while (this.eventQueue.length > MAX_EVENTS) {
      this.eventQueue.shift();
    }
    this.emit("event", fullEvent);
  }
  /**
   * Get all pending events (for initial load)
   */
  getEvents() {
    return [...this.eventQueue];
  }
  /**
   * Clear all events
   */
  clear() {
    this.eventQueue = [];
  }
};
var dashboardHandler = new DashboardEventHandler();

// src/dashboard/server.ts
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "path";
var DASHBOARD_PORT = 3001;
async function startDashboardServer() {
  const fastify = Fastify({
    logger: {
      level: "warn"
    }
  });
  const publicDir = path.join(process.cwd(), "public");
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: "/public/"
  });
  fastify.get("/dashboard", async (_request, reply) => {
    return reply.sendFile("dashboard.html");
  });
  fastify.get("/events", async (request, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    const initialEvents = dashboardHandler.getEvents();
    for (const event of initialEvents) {
      reply.raw.write(`data: ${JSON.stringify(event)}

`);
    }
    const state = { cleanedUp: false, keepalive: null };
    const cleanup = () => {
      if (state.cleanedUp) return;
      state.cleanedUp = true;
      if (state.keepalive) clearInterval(state.keepalive);
      dashboardHandler.off("event", onEvent);
    };
    const onEvent = (event) => {
      if (state.cleanedUp) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}

`);
      } catch {
        cleanup();
      }
    };
    dashboardHandler.on("event", onEvent);
    state.keepalive = setInterval(() => {
      if (state.cleanedUp) return;
      try {
        reply.raw.write(": keepalive\n\n");
      } catch {
        cleanup();
      }
    }, 15e3);
    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);
    return reply.hijack();
  });
  await fastify.listen({ host: "0.0.0.0", port: DASHBOARD_PORT });
  console.log(`\u{1F4CA} Dashboard available at http://localhost:${DASHBOARD_PORT}/dashboard`);
}

// src/index.ts
config();
async function main() {
  console.log("\u{1F989} Starting Owl Internet Customer Service Demo...");
  try {
    const tac = new TAC({ config: TACConfig.fromEnv() });
    const smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);
    const llmService = new LLMService(tac);
    const conversationMessages = /* @__PURE__ */ new Map();
    tac.onMessageReady(
      async ({ message: userMessage, session: context, memory: memoryResponse }) => {
        const convId = context.conversation_id;
        try {
          if (!conversationMessages.has(convId)) {
            conversationMessages.set(convId, []);
          }
          const history = conversationMessages.get(convId);
          history.push({
            role: "user",
            content: userMessage
          });
          console.log(
            `
${"=".repeat(80)}
USER MESSAGE | ${userMessage.substring(0, 50)}${userMessage.length > 50 ? "..." : ""}`
          );
          console.log(`Conversation ID: ${convId}`);
          console.log(`Channel: ${context.channel}`);
          console.log(`Profile ID: ${context.profile_id || "N/A"}`);
          dashboardHandler.pushEvent({
            event_type: "user_message",
            conversation_id: convId,
            channel: context.channel,
            ...context.profile_id && { profile_id: context.profile_id },
            message: userMessage.substring(0, 100) + (userMessage.length > 100 ? "..." : "")
          });
          let finalMemoryResponse = memoryResponse;
          if (!memoryResponse && context.channel === "voice" && tac.isMemoryEnabled()) {
            try {
              finalMemoryResponse = await tac.retrieveMemory(context, userMessage);
              console.log("MEMORY | Retrieved context for voice channel");
              if (context.profile_id) {
                console.log(`MEMORY | Profile resolved: ${context.profile_id}`);
              }
            } catch (error) {
              console.error("Failed to retrieve memory for voice channel:", error);
            }
          }
          if (context.profile_id && tac.isMemoryEnabled() && !context.profile) {
            try {
              const profileResponse = await tac.fetchProfile(context.profile_id);
              if (profileResponse) {
                context.profile = {
                  profile_id: profileResponse.id,
                  traits: profileResponse.traits
                };
                console.log(`PROFILE | Fetched traits for ${context.profile_id}`);
              }
            } catch (error) {
              console.error("Failed to fetch profile:", error);
            }
          }
          if (finalMemoryResponse) {
            const memoryItems = [];
            if (finalMemoryResponse.observations) {
              memoryItems.push(`${finalMemoryResponse.observations.length} observations`);
            }
            if (finalMemoryResponse.summaries) {
              memoryItems.push(`${finalMemoryResponse.summaries.length} summaries`);
            }
            const memorySummary = memoryItems.length > 0 ? memoryItems.join(", ") : "context";
            console.log(`MEMORY | Retrieved ${memorySummary}`);
            dashboardHandler.pushEvent({
              event_type: "memory",
              conversation_id: convId,
              channel: context.channel,
              ...context.profile_id && { profile_id: context.profile_id },
              message: `Retrieved ${memorySummary}`,
              metadata: {
                observations: finalMemoryResponse.observations.map((obs) => ({
                  id: obs.id,
                  content: obs.content,
                  created_at: obs.createdAt,
                  occurred_at: obs.occurredAt,
                  source: obs.source
                })),
                summaries: finalMemoryResponse.summaries.map((sum) => ({
                  id: sum.id,
                  content: sum.content,
                  created_at: sum.createdAt
                })),
                communications: finalMemoryResponse.communications?.map((comm) => ({
                  id: comm.id,
                  author_address: comm.author.address,
                  author_name: comm.author.name,
                  author_type: comm.author.type,
                  content: comm.content.text || "",
                  created_at: comm.created_at
                })) || [],
                observation_count: finalMemoryResponse.observations.length,
                summary_count: finalMemoryResponse.summaries.length,
                communication_count: finalMemoryResponse.communications?.length || 0
              }
            });
          }
          const activeWebsocket = context.channel === "voice" ? voiceChannel.getWebsocket(convId) : null;
          console.log("AI AGENT | Processing message...");
          dashboardHandler.pushEvent({
            event_type: "ai_processing",
            conversation_id: convId,
            channel: context.channel,
            message: "Processing message..."
          });
          const llmResponse = await llmService.processMessage(
            userMessage,
            finalMemoryResponse || null,
            context,
            activeWebsocket,
            history
          );
          if (llmResponse) {
            if (context.channel === "voice") {
              await voiceChannel.sendResponse(convId, llmResponse);
            } else {
              await smsChannel.sendResponse(convId, llmResponse);
            }
            const responsePreview = llmResponse.length > 100 ? llmResponse.substring(0, 100) + "..." : llmResponse;
            console.log(`AI RESPONSE | ${responsePreview}`);
            dashboardHandler.pushEvent({
              event_type: "ai_response",
              conversation_id: convId,
              channel: context.channel,
              ...context.profile_id && { profile_id: context.profile_id },
              message: responsePreview
            });
            if (context.metadata && "pending_handoff" in context.metadata) {
              const pendingHandoff = context.metadata.pending_handoff;
              const handoffDataJson = pendingHandoff.handoff_data;
              if (context.channel === "voice" && handoffDataJson && activeWebsocket) {
                try {
                  console.log(`
${"=".repeat(80)}
HANDOFF | Transferring to human agent...`);
                  dashboardHandler.pushEvent({
                    event_type: "handoff",
                    conversation_id: convId,
                    channel: context.channel,
                    message: "Transferring to human agent..."
                  });
                  activeWebsocket.send(
                    JSON.stringify({ type: "end", handoffData: handoffDataJson })
                  );
                  delete context.metadata.pending_handoff;
                } catch (error) {
                  console.error("Handoff failed:", error);
                }
              }
            }
            history.push({
              role: "assistant",
              content: llmResponse
            });
          }
        } catch (error) {
          console.error("Error processing message:", error);
          dashboardHandler.pushEvent({
            event_type: "error",
            conversation_id: convId,
            channel: context.channel,
            message: error instanceof Error ? error.message : "Unknown error"
          });
          const errorMessage = "I'm experiencing technical difficulties. Please try again.";
          if (context.channel === "voice") {
            await voiceChannel.sendResponse(convId, errorMessage);
          } else {
            await smsChannel.sendResponse(convId, errorMessage);
          }
        }
      }
    );
    tac.onHandoff(({ conversationId, reason }) => {
      console.log(`\u{1F91D} Handoff requested for ${conversationId}`);
      console.log(`Reason: ${reason || "N/A"}`);
    });
    const handoffHandler = (payload) => {
      console.log(`FLEX HANDOFF | Processing handoff for call ${payload.CallSid}`);
      const formData = {
        HandoffData: payload.HandoffData || "",
        CallStatus: payload.CallStatus
      };
      const result = handleFlexHandoffLogic(formData, process.env.FLEX_WORKFLOW_SID);
      if (result.success) {
        console.log("FLEX HANDOFF | Generated TwiML to enqueue to Flex workflow");
      } else {
        console.log(`FLEX HANDOFF | Error: ${result.content}`);
      }
      return Promise.resolve(result.content);
    };
    const server = new TACServer(tac, {
      development: true,
      voice: {
        port: Number(process.env.PORT) || 8e3
      },
      conversationRelayConfig: {
        welcomeGreeting: "Hello! Thank you for calling Owl Internet. How can I help you today?"
      },
      handoffHandler
    });
    await server.start();
    await startDashboardServer();
    console.log("\u2705 Owl Internet Customer Service Demo is running!");
    console.log("");
    console.log("\u{1F4CB} Webhook Configuration:");
    console.log("\u2022 Conversations Service webhook: POST http://your-domain.com/conversation");
    console.log("\u2022 Phone Number Voice webhook: POST http://your-domain.com/twiml");
    console.log("\u2022 Phone Number Message webhook: NOT needed (Conversations handles SMS routing)");
    console.log("");
    console.log("\u{1F527} Available Tools:");
    console.log("\u2022 Get available plans");
    console.log("\u2022 Look up plan pricing");
    console.log("\u2022 Check service outages by zip code");
    console.log("\u2022 Run router diagnostics");
    console.log("\u2022 Look up available discounts");
    console.log("\u2022 Confirm orders via SMS");
    console.log("\u2022 Escalate to human agent (voice only)");
    console.log("");
    console.log("\u{1F4AC} Try these example requests:");
    console.log('\u2022 "What internet plans do you have?"');
    console.log('\u2022 "How much is the 1000 Mbps plan?"');
    console.log('\u2022 "Check for outages in 94103"');
    console.log('\u2022 "Run diagnostics on my OWL-R2021 router"');
    console.log('\u2022 "I need to speak with someone"');
    process.on("SIGINT", () => {
      void (async () => {
        console.log("\n\u{1F6D1} Shutting down...");
        await server.stop();
        process.exit(0);
      })();
    });
  } catch (error) {
    console.error("\u274C Failed to start demo:", error);
    process.exit(1);
  }
}
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});
void main();
//# sourceMappingURL=index.js.map