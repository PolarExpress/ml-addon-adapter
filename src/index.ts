/*
 * This program has been developed by students from the bachelor
 * Computer Science at Utrecht University within the Software Project course.
 *
 * © Copyright Utrecht University
 * (Department of Information and Computing Sciences)
 */

import {
  AmqpConfig,
  createAmqpSocket,
  createRoutingKeyStore
} from "ts-amqp-socket";

import { panic } from "./utils";

async function main() {
  const addonId = process.env.ADDON_ID ?? panic("ADDON_ID not set");
  const addonPort = process.env.ADDON_PORT ?? 8800;

  const amqpConfig: AmqpConfig = {
    bodyMapper: message => {
      return JSON.parse(message.content.toString());
    },
    errorType: `ml_service_error`,
    exchange: {
      request: "ml-direct-exchange",
      response: "ui-direct-exchange"
    },

    queue: {
      request: `ml-${addonId}-request-queue`
    },
    routingKey: {
      request: `ml-${addonId}-request`
    },
    successType: `ml_result`
  };

  const routingKeyStore = await createRoutingKeyStore();
  const amqpSocket = await createAmqpSocket(amqpConfig, routingKeyStore);

  amqpSocket.handle("__default", async (data: object) => {
    const result = await fetch(`http://ml-${addonId}-service:${addonPort}`, {
      body: JSON.stringify(data),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    if (!result.ok) {
      throw new Error(await result.text());
    }
    return { addonId, result: await result.json() };
  });

  console.log("Listening for messages...");
  amqpSocket.listen();
}

main().catch(error => {
  console.error(error);
  throw error;
});
