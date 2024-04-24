/*
 * This program has been developed by students from the bachelor
 * Computer Science at Utrecht University within the Software Project course.
 *
 * © Copyright Utrecht University
 * (Department of Information and Computing Sciences)
 */

import { AmqpConfig, createAmqpSocket, createRoutingKeyStore } from "ts-amqp-socket";
import { panic } from "./utils";

async function main() {
  const addonId = process.env.ADDON_ID ?? panic("ADDON_ID not set");
  const addonPort = process.env.ADDON_PORT ?? 8800;

  const amqpConfig: AmqpConfig = {
    queue: {
      request: `ml-${addonId}-request-queue`
    },
    exchange: {
      request: "ml-direct-exchange",
      response: "ui-direct-exchange"
    },
    routingKey: {
      request: `ml-${addonId}-request`
    },

    successType: `${addonId}`,
    errorType: `ml_service_error`,
    bodyMapper: message => {
      return JSON.parse(message.content.toString());
    }
  };

  const routingKeyStore = await createRoutingKeyStore();
  const amqpSocket = await createAmqpSocket(amqpConfig, routingKeyStore);

  amqpSocket.handle("__default", async (data: object) => {
    const result = await fetch(`http://ml-${addonId}-service:${addonPort}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
    if (!result.ok) {
      throw new Error(await result.text());
    }
    return await result.json();
  });

  console.log("Listening for messages...");
  amqpSocket.listen();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
