/**
 * Per-key async mutex to prevent concurrent init/delete/restore
 * for the same instance key creating duplicate sockets
 * against the same MongoDB collection (WhatsApp 440 conflict).
 */
const locks = new Map()

async function withInstanceLock(key, fn) {
    const k = String(key || '__global__')
    while (locks.get(k)) {
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    locks.set(k, true)
    try {
        return await fn()
    } finally {
        locks.delete(k)
    }
}

module.exports = { withInstanceLock }
