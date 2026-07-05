export type TelegramBotCatalogConnectActionErrorCode =
  | "invalid"
  | "telegramTokenCheckUnavailable"
  | "telegramTokenDuplicate"
  | "telegramTokenInvalid";

export type TelegramBotCatalogConnectActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "setupQueued";
      readonly connectorId: string;
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: TelegramBotCatalogConnectActionErrorCode;
      readonly duplicateConnectorId?: string;
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialTelegramBotCatalogConnectActionState: TelegramBotCatalogConnectActionState =
  {
    status: "idle"
  };
