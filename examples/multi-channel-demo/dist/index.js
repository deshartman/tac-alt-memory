#!/usr/bin/env node

// src/index.ts
import { config } from "dotenv";
import OpenAI from "openai";
import { TAC, SMSChannel, VoiceChannel } from "@twilio/tac-core";
import { TACServer } from "@twilio/tac-server";
import {
  createMemoryTools,
  createMessagingTools,
  createHandoffTools,
  defineTool
} from "@twilio/tac-tools";
config();
var openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
var customerDatabase = /* @__PURE__ */ new Map([
  [
    "+1234567890",
    {
      name: "John Doe",
      accountNumber: "ACC-12345",
      plan: "Premium Internet 100Mbps",
      address: "123 Main St, City, State",
      outages: ["2024-01-15: Planned maintenance", "2024-01-10: Network upgrade"],
      balance: 79.99
    }
  ],
  [
    "+0987654321",
    {
      name: "Jane Smith",
      accountNumber: "ACC-67890",
      plan: "Basic Internet 50Mbps",
      address: "456 Oak Ave, Town, State",
      outages: [],
      balance: 49.99
    }
  ]
]);
async function main() {
  console.log("\u{1F3E2} Starting Multi-Channel Customer Service Demo...");
  try {
    const tac = new TAC();
    const smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);
    const memoryClient = tac.getMemoryClient();
    const memoryStoreId = tac.getConfig().memoryStoreId;
    const memoryTools = memoryClient && memoryStoreId ? createMemoryTools(memoryClient, memoryStoreId) : null;
    const customerLookupTool = defineTool(
      "lookup_customer_info",
      "Look up customer information including account details, service plan, and billing information",
      {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Customer phone number" }
        },
        required: ["phone_number"]
      },
      ({ phone_number }) => {
        const customer = customerDatabase.get(phone_number);
        if (!customer) {
          return { error: "Customer not found" };
        }
        return {
          success: true,
          customer
        };
      }
    );
    const checkOutagesTool = defineTool(
      "check_service_outages",
      "Check for current or recent service outages in the customer area",
      {
        type: "object",
        properties: {
          phone_number: {
            type: "string",
            description: "Customer phone number to check outages for"
          }
        },
        required: ["phone_number"]
      },
      ({ phone_number }) => {
        const customer = customerDatabase.get(phone_number);
        if (!customer) {
          return { error: "Customer not found" };
        }
        const hasCurrentOutage = Math.random() < 0.1;
        return {
          current_outages: hasCurrentOutage ? ["Network maintenance in your area"] : [],
          recent_outages: customer.outages,
          estimated_resolution: hasCurrentOutage ? "2 hours" : null
        };
      }
    );
    const scheduleTechnicianTool = defineTool(
      "schedule_technician",
      "Schedule a technician visit for service issues",
      {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Customer phone number" },
          issue_description: { type: "string", description: "Description of the technical issue" },
          preferred_time: { type: "string", description: "Preferred appointment time (optional)" }
        },
        required: ["phone_number", "issue_description"]
      },
      ({
        phone_number,
        issue_description,
        preferred_time
      }) => {
        const customer = customerDatabase.get(phone_number);
        if (!customer) {
          return { error: "Customer not found" };
        }
        const appointmentId = `TECH-${Date.now()}`;
        const scheduledTime = preferred_time || "Tomorrow 9AM-12PM";
        return {
          success: true,
          appointment_id: appointmentId,
          scheduled_time: scheduledTime,
          technician: "Mike Johnson",
          customer_name: customer.name,
          issue: issue_description
        };
      }
    );
    const customerServiceTools = [
      customerLookupTool,
      checkOutagesTool,
      scheduleTechnicianTool
    ];
    const conversationHistory = /* @__PURE__ */ new Map();
    tac.onMessageReady(
      async ({
        conversationId,
        profileId,
        message,
        author,
        memory,
        session: _session,
        channel
      }) => {
        console.log(`\u{1F4F1} [${channel.toUpperCase()}] Message from ${author}: ${message}`);
        const activeChannel = tac.getChannel(channel);
        try {
          const history = conversationHistory.get(conversationId) || [];
          history.push({
            role: "user",
            content: message
          });
          const systemPrompt = `You are a helpful customer service agent for TechCorp Internet Services. You have access to tools to:

1. Look up customer information (lookup_customer_info)
2. Check service outages (check_service_outages)
3. Schedule technician visits (schedule_technician)
4. Retrieve customer memory/history (retrieve_profile_memory)
5. Escalate to human agents when needed

Key guidelines:
- Always be friendly and professional
- Use tools to get accurate information
- If you can't help, offer to connect them with a human agent
- Remember previous interactions using the memory system

Customer communication channel: ${channel.toUpperCase()}
${memory?.observations.length ? `Previous interactions: ${memory.observations.slice(0, 3).map((o) => o.content).join("; ")}` : ""}`;
          const messages = [
            { role: "system", content: systemPrompt },
            ...history.slice(-10)
            // Keep last 10 messages for context
          ];
          const messagingTools = createMessagingTools();
          const handoffTools = createHandoffTools();
          const contextualTools = [
            ...customerServiceTools,
            messagingTools.forConversation(tac.getChannel(channel), conversationId),
            handoffTools.forConversation(tac, conversationId)
          ];
          if (profileId && memoryTools) {
            contextualTools.push(memoryTools.forSession(profileId));
          }
          const openaiTools = contextualTools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters
            }
          }));
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            tools: openaiTools,
            tool_choice: "auto",
            temperature: 0.7
          });
          const response = completion.choices[0]?.message;
          if (!response) {
            throw new Error("No response from OpenAI");
          }
          if (response.tool_calls) {
            const toolResults = [];
            for (const toolCall of response.tool_calls) {
              const tool = contextualTools.find((t) => t.name === toolCall.function.name);
              if (tool) {
                try {
                  const params = JSON.parse(toolCall.function.arguments);
                  const result = await tool.implementation(params);
                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: JSON.stringify(result)
                  });
                } catch (error) {
                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: JSON.stringify({ error: error.message })
                  });
                }
              }
            }
            history.push({
              role: "assistant",
              content: response.content,
              tool_calls: response.tool_calls
            });
            history.push(...toolResults);
            const finalMessages = [
              { role: "system", content: systemPrompt },
              ...history.slice(-15)
            ];
            const finalCompletion = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: finalMessages,
              temperature: 0.7
            });
            const finalResponse = finalCompletion.choices[0]?.message?.content;
            if (finalResponse) {
              history.push({
                role: "assistant",
                content: finalResponse
              });
              conversationHistory.set(conversationId, history);
              console.log(`\u{1F50A} [RESPONSE] Sending: ${finalResponse}`);
              await activeChannel?.sendResponse(conversationId, finalResponse);
              return;
            }
          }
          if (response.content) {
            history.push({
              role: "assistant",
              content: response.content
            });
            conversationHistory.set(conversationId, history);
            console.log(`\u{1F50A} [RESPONSE] Sending: ${response.content}`);
            await activeChannel?.sendResponse(conversationId, response.content);
            return;
          }
          const fallback = "I apologize, but I'm having trouble processing your request right now. Let me connect you with a human agent who can help.";
          console.log(`\u{1F50A} [RESPONSE] Sending fallback: ${fallback}`);
          await activeChannel?.sendResponse(conversationId, fallback);
        } catch (error) {
          console.error("Error processing message:", error);
          const errorMsg = "I'm experiencing technical difficulties. Let me connect you with a human agent who can assist you immediately.";
          console.log(`\u{1F50A} [RESPONSE] Sending error: ${errorMsg}`);
          await activeChannel?.sendResponse(conversationId, errorMsg);
        }
      }
    );
    tac.onInterrupt(({ conversationId, reason, transcript, session: _session }) => {
      console.log(`\u{1F5E3}\uFE0F User interrupted on ${conversationId}: ${reason}`);
      if (transcript) {
        console.log(`Partial transcript: ${transcript}`);
      }
    });
    tac.onHandoff(({ conversationId, profileId: _profileId, reason, session }) => {
      console.log(`\u{1F91D} Handoff requested for ${conversationId}: ${reason}`);
      const customer = session.channel === "sms" ? customerDatabase.get(session.conversation_id) : { name: "Unknown Customer" };
      console.log(`Creating support ticket for ${customer?.name || "Unknown"}`);
      console.log(`Channel: ${session.channel}`);
      console.log(`Reason: ${reason}`);
    });
    const server = new TACServer(tac, {
      development: true,
      conversationRelayConfig: {
        welcomeGreeting: "Hello! Thank you for calling TechCorp Internet Services. How can I help you today?",
        transcriptionProvider: "Deepgram",
        ttsProvider: "Google",
        voice: "en-US-Journey-O",
        interruptible: "any",
        dtmfDetection: true
      },
      voice: {
        port: Number(process.env.PORT) || 8e3
      }
    });
    await server.start();
    console.log("\u2705 Multi-Channel Customer Service Demo is running!");
    console.log("");
    console.log("\u{1F4CB} Webhook Configuration:");
    console.log("\u2022 Conversations Service webhook: POST http://your-domain.com/conversation");
    console.log("\u2022 Phone Number Voice webhook: POST http://your-domain.com/twiml");
    console.log("\u2022 Phone Number Message webhook: NOT needed (Conversations handles SMS routing)");
    console.log("");
    console.log("\u{1F527} Available Tools:");
    console.log("\u2022 Customer lookup by phone number");
    console.log("\u2022 Service outage checking");
    console.log("\u2022 Technician scheduling");
    console.log("\u2022 Memory retrieval");
    console.log("\u2022 Human handoff");
    console.log("");
    console.log("\u{1F4AC} Try these example requests:");
    console.log('\u2022 "Check my account status"');
    console.log('\u2022 "Is there an outage in my area?"');
    console.log('\u2022 "Schedule a technician visit"');
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