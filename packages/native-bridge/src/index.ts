export type NativeClientKind = "web" | "mobile" | "desktop";

export type NativeAppMetadata = {
  appName: string;
  version: string;
  buildNumber?: string;
  client: NativeClientKind;
};

export type DeepLinkTarget =
  | { type: "conversation"; conversationId: string }
  | { type: "support_case"; supportCaseId: string }
  | { type: "client"; clientId: string }
  | { type: "integration_setup"; moduleId: string };

export type NotificationEndpointRegistration = {
  tenantId: string;
  employeeId: string;
  client: NativeClientKind;
  endpointToken: string;
  appVersion: string;
};

export type NativeBridge = {
  getAppMetadata(): Promise<NativeAppMetadata>;
  openDeepLink(target: DeepLinkTarget): Promise<void>;
  registerNotificationEndpoint(
    input: NotificationEndpointRegistration
  ): Promise<void>;
};
