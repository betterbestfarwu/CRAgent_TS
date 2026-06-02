/** Strip heavy image payloads before sending sessions to the renderer. */
export function stripMessageImagesForUi(message) {
    if (!message?.images?.length) {
        return message;
    }
    return {
        ...message,
        images: message.images.map((image) => ({
            mimeType: image.mimeType,
            hasData: Boolean(image.dataUrl),
        })),
    };
}

export function stripSessionImagesForUi(session) {
    if (!session?.messages?.length) {
        return session;
    }

    let changed = false;
    const messages = session.messages.map((message) => {
        if (!message?.images?.length) {
            return message;
        }
        changed = true;
        return stripMessageImagesForUi(message);
    });

    return changed ? { ...session, messages } : session;
}
