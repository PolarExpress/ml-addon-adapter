/*
 * This program has been developed by students from the bachelor
 * Computer Science at Utrecht University within the Software Project course.
 *
 * © Copyright Utrecht University
 * (Department of Information and Computing Sciences)
 */

import amqp, { ConsumeMessage } from "amqplib";

import { RoutingKeyStore } from "./routingKeyStore";
import { panic } from "./utils";

/**
 * Configuration for the AMQP socket
 */
export interface SessionData {
  username: string;
  userID: string;
  impersonateID: string;
  sessionID: string;
  saveStateID: string;
  roomID: string;
  jwt: string;
}

export type Handler = (req: object) => Promise<unknown>;

export type AuthHandler = (
  req: object,
  session: SessionData
) => Promise<unknown>;

export interface AmqpConfig {
  queue: {
    request: string;
  };
  exchange: {
    request: string;
    response: string;
  };
  routingKey: {
    request: string;
  };
  successType: string;
  errorType: string;  
  bodyMapper: (message: ConsumeMessage) => AmqpRequestData;
}

interface AmqpResponse {
  value: unknown;
  type: string;
  callID: string;
  status: string;
}
interface AmqpRequest {
  sessionData: SessionData;
  fromFrontend: {
    callID: string;
    body: string;
  };
}

/**
 * Creates an AMQP socket
 * @param routingKeyStore The routing-key store to use
 * @returns The created AMQP socket
 */
export async function createAmqpSocket(
  config: AmqpConfig,
  routingKeyStore: RoutingKeyStore
) {
  const opt = {
    credentials: amqp.credentials.plain(
      process.env.RABBIT_USER ?? panic("RABBIT_USER not set"),
      process.env.RABBIT_PASSWORD ?? panic("RABBIT_PASSWORD not set")
    )
  };

  const host = process.env.RABBIT_HOST ?? panic("RABBIT_HOST not set");
  const port = process.env.RABBIT_PORT ?? panic("RABBIT_PORT not set");
  const connection = await amqp.connect(`amqp://${host}:${port}`, opt);

  const channel = await connection.createChannel();

  return new AmqpSocket(config, channel, routingKeyStore);
}

/**
 * Context for publishing a message
 * @param routingKey The routing key to send the message to
 * @param callID The call ID of the message
 * @param headers The headers of the message
 */
interface PublishContext {
  routingKey: string;
  callID: string;
  headers: amqp.MessagePropertyHeaders | undefined;
}

interface AmqpRequestData {
  action?: string;
}

export class AmqpSocket {
  private handlers: Record<string, AuthHandler> = {};

  public constructor(
    private config: AmqpConfig,
    private channel: amqp.Channel,
    private routingKeyStore: RoutingKeyStore
  ) {
    this.channel.assertQueue(config.queue.request);
    this.channel.assertExchange(config.exchange.request, "direct");
    this.channel.bindQueue(
      config.queue.request,
      config.exchange.request,
      config.routingKey.request
    );

    this.channel.assertExchange(config.exchange.response, "direct");
  }

  /**
   * Registers a handler for a specific action
   * @param key The action to register the handler for
   * @param handler The handler to register
   */
  public handle(key: string, handler: AuthHandler) {
    this.handlers[key] = handler;
  }

  /**
   * Publishes a message to the frontend
   * @param context Publish context needed to send the message
   * @param response The response to send to the frontend
   * @param type The type of the message (used for type-based callbacks in the frontend)
   * @param status The status of the message (e.g. success, error, ...)
   */
  private publish(
    context: PublishContext,
    response: unknown,
    type: string,
    status: string
  ) {
    const responseMessage: AmqpResponse = {
      value: response,
      type: type,
      callID: context.callID,
      status: status
    };

    this.channel.publish(
      this.config.exchange.response,
      context.routingKey,
      Buffer.from(JSON.stringify(responseMessage)),
      { headers: context.headers }
    );
  }

  /**
   * Publishes a success message to the frontend
   * @param context Publish context needed to send the message
   * @param response The response to send to the frontend
   */
  private publishSuccess(context: PublishContext, response: unknown) {
    this.publish(context, response, this.config.successType, "success");
  }

  /**
   * Publishes an error message to the frontend
   * @param context Publish context needed to send the message
   * @param error The error message to send to the frontend
   */
  private publishError(context: PublishContext, error: string) {
    this.publish(context, { error: error }, this.config.errorType, "error");
  }

  /**
   * Start listening for messages.
   * This function will block the current thread.
   */
  public listen() {
    this.channel.consume(this.config.queue.request, async message => {
      if (!message) {
        return;
      }
      this.channel.ack(message);
      console.log("Received message:", message);

      const headerContent = JSON.parse(message.properties.headers?.message.toString()) as AmqpRequest;
      const body: AmqpRequestData = this.config.bodyMapper(message);
      const sessionId = headerContent.sessionData.sessionID;

      const routingKey = await this.routingKeyStore.get(sessionId);

      console.log("Routing key:", routingKey);
      if (routingKey == null) {
        console.warn("Routing key not found, session is no longer alive");
        console.warn("Ignoring...");
        return;
      }

      const ctx: PublishContext = {
        routingKey: routingKey,
        callID: headerContent.fromFrontend.callID,
        headers: message.properties.headers
      };

      if (body.action == null && !("__default" in this.handlers)) {
        this.publishError(ctx, "No action specified");
        return;
      }
      body.action = "__default";

      if (!(body.action in this.handlers)) {
        this.publishError(ctx, `Action "${body.action}" doesn't exist`);
        return;
      }

      const handler = this.handlers[body.action ?? ""];
      try {
        const response = await handler(body, headerContent.sessionData);
        this.publishSuccess(ctx, response);
      } catch (error) {
        // TODO: proper errors
        const message =
          error instanceof Error ? error.message : "An error occurred";
        this.publishError(ctx, message);
      }
    });
  }
}
