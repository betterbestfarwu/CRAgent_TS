export const IPC_CHANNELS = {
    getSnapshot: "app:getSnapshot",
    getSession: "session:get",
    newSession: "session:new",
    deleteSession: "session:delete",
    sendChat: "chat:send",
    updateModel: "session:updateModel",
    updateConfig: "config:update",
    syncProviderModels: "config:syncProviderModels",
    onMessageAppended: "events:messageAppended",
    onSessionChanged: "events:sessionChanged",
    onBusyChanged: "events:busyChanged",
    onError: "events:error",
};
