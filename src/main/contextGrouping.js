/** Group messages at user-turn boundaries (API round approximations). */
export function groupMessagesByApiRound(messages) {
    const groups = [];
    let current = [];

    for (const message of messages) {
        const startsNewRound =
            message.role === "user" &&
            current.length > 0 &&
            current.some((entry) => entry.role !== "user");

        if (startsNewRound) {
            groups.push(current);
            current = [];
        }
        current.push(message);
    }

    if (current.length) {
        groups.push(current);
    }

    return groups;
}

export function truncateGroupsFromHead(messages, dropGroupCount) {
    if (dropGroupCount <= 0) {
        return messages;
    }
    const groups = groupMessagesByApiRound(messages);
    return groups.slice(dropGroupCount).flat();
}
