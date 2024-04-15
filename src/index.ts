import { AmqpConfig, createAmqpSocket } from "./amqp";
import { createRoutingKeyStore } from "./routingKeyStore";
import { panic } from "./utils";


async function main() {
  let addonId = process.env.ADDON_ID ?? panic("ADDON_ID not set");

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

    successType: `ml_service_result`,
    errorType: `ml_service_error`,
  };

  let routingKeyStore = await createRoutingKeyStore();
  let amqpSocket = await createAmqpSocket(amqpConfig, routingKeyStore);

  amqpSocket.handle("", async (data) => {
    return await fetch("http://ml-addon-service:3000", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
  });

  amqpSocket.listen();
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});