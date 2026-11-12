const { WhatsAppInstance } = require('../class/instance')
const config = require('../../config/config')
const { Session } = require('../class/session')
const { withInstanceLock } = require('../helper/instanceLock')

function disconnectHint(statusCode) {
    switch (statusCode) {
        case 405:
            return 'WhatsApp rejected the handshake (405 Method Not Allowed). Usually outdated WA Web version. Server already negotiates the live version; if this persists, rebuild without cache to update Baileys.'
        case 440:
            return 'Connection replaced (440). Another socket is using the same auth collection. Do not run the same key against the same MongoDB from two processes.'
        case 401:
            return 'Logged out (401). The session is invalid. Call DELETE /api/instance/delete then GET /api/instance/init with the same key for a fresh pairing.'
        case 515:
            return 'Restart required (515). The server already restarts the socket automatically; wait a few seconds and poll again.'
        default:
            return 'Socket closed before QR. Wait a few seconds and poll again. If it persists, check server logs for "connection errored".'
    }
}

function disconnectAction(statusCode) {
    if (statusCode === 401) return 'call_delete_and_init'
    return 'wait_and_retry'
}

function snapshot(key) {
    const inst = WhatsAppInstances[key]
    return {
        instance: inst,
        qrcode: inst?.instance?.qr ?? '',
        online: !!inst?.instance?.online,
        qrRetry: inst?.instance?.qrRetry ?? 0,
        maxRetry: Number(config.instance.maxRetryQr),
        registered: !!inst?.authState?.state?.creds?.registered,
        lastDisconnect: inst?.instance?.lastDisconnect ?? null,
    }
}

// RAM -> Mongo restore -> create. Never throws for missing key,
// so callers never need to worry about init/delete/restore order.
async function ensureInstance(key, opts = {}) {
    const { autoCreate = true, webhook = false, webhookUrl = null } = opts
    if (!key) return { instance: null, mode: 'missing_key' }
    if (WhatsAppInstances[key]) return { instance: WhatsAppInstances[key], mode: 'ram' }
    try {
        const session = new Session()
        const restored = await session.restoreOne(key)
        if (restored && WhatsAppInstances[key]) {
            return { instance: WhatsAppInstances[key], mode: 'restored' }
        }
    } catch (_) {
        // fall through to create
    }
    if (!autoCreate) return { instance: null, mode: 'not_found' }
    const inst = new WhatsAppInstance(key, webhook, webhookUrl)
    await inst.init()
    WhatsAppInstances[inst.key] = inst
    return { instance: inst, mode: 'created' }
}

exports.init = async (req, res) => {
    const key = req.query.key?.toString()
    if (!key) {
        return res.status(400).json({
            error: true,
            status: 'MISSING_KEY',
            message: "Missing 'key' query param. Example: /api/instance/init?key=190",
            action: 'provide_key',
            hint: 'Pick any stable key per store/device, e.g. ?key=loja01. Then poll /qrbase64 with the same key.',
        })
    }
    try {
        const result = await withInstanceLock(key, async () => {
            const webhook = !req.query.webhook ? false : req.query.webhook
            const webhookUrl = !req.query.webhookUrl ? null : req.query.webhookUrl
            const rawAppUrl = config.appUrl || req.protocol + '://' + req.headers.host
            const appUrl = rawAppUrl.replace(/\/+$/, '')

            const existing = WhatsAppInstances[key]
            if (existing) {
                const detail = await existing.getInstanceDetail(key)
                if (detail?.phone_connected) {
                    return {
                        http: 200,
                        body: {
                            error: false,
                            status: 'CONNECTED',
                            message: `Instance '${key}' is already connected. No QR needed.`,
                            action: 'none',
                            key: key,
                            instance_data: detail,
                        },
                    }
                }
                const s = snapshot(key)
                if (s.qrcode && s.qrcode.trim() !== '' && s.qrcode.trim() !== ' ') {
                    return {
                        http: 200,
                        body: {
                            error: false,
                            status: 'QR_READY',
                            message: `Instance '${key}' already has a QR. Scan it now.`,
                            action: 'scan_now',
                            key: key,
                            qrcode: {
                                base64: s.qrcode,
                                url: appUrl + '/instance/qr?key=' + key,
                            },
                            qrRetry: s.qrRetry,
                            maxRetry: s.maxRetry,
                            browser: config.browser,
                        },
                    }
                }
                // Disconnected without QR: recycle socket to avoid duplicates.
                try {
                    existing.teardownSocket?.() || existing.instance?.sock?.ws?.close()
                } catch (_) {
                    // ignora
                }
                const fresh = new WhatsAppInstance(key, webhook, webhookUrl)
                await fresh.init()
                WhatsAppInstances[key] = fresh
                return {
                    http: 200,
                    body: {
                        error: false,
                        status: 'RECREATED',
                        message: `Instance '${key}' was idle/disconnected and was recreated. Poll /qrbase64 every 3s.`,
                        action: 'poll_qrbase64',
                        key: key,
                        qrcode: { url: appUrl + '/instance/qr?key=' + key },
                        hint: `GET /api/instance/qrbase64?key=${key} every 3s for ~30s, then GET /api/instance/info?key=${key}.`,
                        browser: config.browser,
                    },
                }
            }

            const instance = new WhatsAppInstance(key, webhook, webhookUrl)
            const data = await instance.init()
            WhatsAppInstances[data.key] = instance
            return {
                http: 200,
                body: {
                    error: false,
                    status: 'CREATED',
                    message: `Instance '${key}' initializing. QR is generated asynchronously; poll /qrbase64.`,
                    action: 'poll_qrbase64',
                    key: data.key,
                    webhook: { enabled: webhook, webhookUrl: webhookUrl },
                    qrcode: { url: appUrl + '/instance/qr?key=' + data.key },
                    hint: `GET /api/instance/qrbase64?key=${data.key} every 3s for ~30s.`,
                    browser: config.browser,
                },
            }
        })
        return res.status(result.http).json(result.body)
    } catch (e) {
        return res.status(500).json({
            error: true,
            status: 'INIT_FAILED',
            message: `Could not initialize instance '${key}'.`,
            action: 'retry_init',
            hint: String(e?.message || e),
            key: key,
        })
    }
}

exports.qr = async (req, res) => {
    try {
        const key = req.query.key?.toString()
        if (!key) {
            return res.status(400).json({
                error: true,
                status: 'MISSING_KEY',
                message: "Missing 'key' query param.",
                action: 'provide_key',
            })
        }
        const { instance } = await ensureInstance(key, { autoCreate: true })
        const qrcode = instance?.instance?.qr ?? ''
        res.render('qrcode', { qrcode: qrcode })
    } catch {
        res.json({ qrcode: '' })
    }
}

exports.qrbase64 = async (req, res) => {
    const key = req.query.key?.toString()
    if (!key) {
        return res.status(400).json({
            error: true,
            status: 'MISSING_KEY',
            message: "Missing 'key' query param. Example: /api/instance/qrbase64?key=190",
            action: 'provide_key',
            hint: 'Use the same key you passed to /init.',
            qrcode: '',
        })
    }
    try {
        const ensured = await withInstanceLock(key, async () =>
            ensureInstance(key, { autoCreate: true })
        )
        const s = snapshot(key)
        const maxRetry = s.maxRetry

        if (s.online) {
            return res.json({
                error: false,
                status: 'CONNECTED',
                message: `Instance '${key}' is connected. No QR needed.`,
                action: 'none',
                qrcode: '',
                connected: true,
                online: true,
                qrRetry: s.qrRetry,
                maxRetry: maxRetry,
                key: key,
            })
        }

        if (s.qrcode && s.qrcode.trim() !== '' && s.qrcode.trim() !== ' ') {
            return res.json({
                error: false,
                status: 'QR_READY',
                message: 'QR Base64 fetched successfully. Scan it now; it expires fast.',
                action: 'scan_now',
                qrcode: s.qrcode,
                connected: false,
                online: false,
                qrRetry: s.qrRetry,
                maxRetry: maxRetry,
                key: key,
            })
        }

        if (s.qrRetry >= maxRetry) {
            return res.json({
                error: true,
                status: 'QR_EXPIRED',
                message: `QR expired for '${key}' (attempts ${s.qrRetry}/${maxRetry}). A fresh QR was requested automatically; poll again. If this repeats, call DELETE then INIT.`,
                action: 'poll_qrbase64',
                hint: `GET /api/instance/init?key=${key} recreates the socket, then poll this endpoint every 3s.`,
                qrcode: '',
                connected: false,
                online: false,
                qrRetry: s.qrRetry,
                maxRetry: maxRetry,
                registered: s.registered,
                lastDisconnect: s.lastDisconnect,
                key: key,
            })
        }

        const code = s.lastDisconnect?.statusCode ?? null
        if (code === 405 || code === 440 || code === 401 || code === 515) {
            return res.json({
                error: true,
                status: 'CONNECTION_FAILED',
                message: `Instance '${key}' failed before QR (status ${code}). ${disconnectHint(code)}`,
                action: disconnectAction(code),
                hint:
                    code === 401
                        ? `DELETE /api/instance/delete?key=${key} then GET /api/instance/init?key=${key}.`
                        : `Wait 5s and poll again. Check server logs for "connection errored". Instance was ${ensured.mode}.`,
                qrcode: '',
                connected: false,
                online: false,
                qrRetry: s.qrRetry,
                maxRetry: maxRetry,
                registered: s.registered,
                lastDisconnect: s.lastDisconnect,
                key: key,
            })
        }

        return res.json({
            error: true,
            status: ensured.mode === 'created' ? 'INITIALIZING' : 'CONNECTING',
            message:
                ensured.mode === 'created'
                    ? `Instance '${key}' just created. QR not ready yet, poll again in 3 seconds.`
                    : 'QR not ready yet, try again in a few seconds.',
            action: 'wait_and_retry',
            hint: `Poll GET /api/instance/qrbase64?key=${key} every 3s for ~30s. Check GET /api/instance/info?key=${key} for lastDisconnect.`,
            qrcode: '',
            connected: false,
            online: false,
            qrRetry: s.qrRetry,
            maxRetry: maxRetry,
            registered: s.registered,
            lastDisconnect: s.lastDisconnect,
            key: key,
        })
    } catch (e) {
        return res.json({
            error: true,
            status: 'QR_FETCH_FAILED',
            message: 'Unable to fetch QR. Retry /init then /qrbase64.',
            action: 'retry_init',
            hint: String(e?.message || e),
            qrcode: '',
            key: key,
        })
    }
}

exports.info = async (req, res) => {
    const key = req.query.key?.toString()
    if (!key) {
        return res.status(400).json({
            error: true,
            status: 'MISSING_KEY',
            message: "Missing 'key' query param.",
            action: 'provide_key',
        })
    }
    const instance = WhatsAppInstances[key]
    if (!instance) {
        return res.status(404).json({
            error: true,
            status: 'NOT_FOUND',
            message: `Instance '${key}' not found on this server.`,
            action: 'call_init',
            hint: `GET /api/instance/init?key=${key} then poll /qrbase64. Each VPS has its own MongoDB, so create the key on this VPS.`,
            key: key,
        })
    }
    let data
    try {
        data = await instance.getInstanceDetail(key)
    } catch (error) {
        data = {
            instance_key: key,
            phone_connected: false,
            webhookUrl: null,
            user: {},
        }
    }
    if (typeof data.phone_connected !== 'boolean') {
        data.phone_connected = !!data.phone_connected
    }
    if (!data.user || typeof data.user !== 'object') {
        data.user = {}
    }
    if (!('webhookUrl' in data)) {
        data.webhookUrl = null
    }
    return res.json({
        error: false,
        status: data.phone_connected ? 'CONNECTED' : data.hasQr ? 'QR_READY' : 'CONNECTING',
        message: 'Instance fetched successfully.',
        action: data.phone_connected ? 'none' : data.hasQr ? 'scan_now' : 'poll_qrbase64',
        instance_data: data,
    })
}

exports.restore = async (req, res, next) => {
    try {
        const session = new Session()
        let restoredSessions = await session.restoreSessions()
        return res.json({
            error: false,
            status: 'RESTORED',
            message: 'All instances restored.',
            action: 'none',
            data: restoredSessions,
        })
    } catch (error) {
        next(error)
    }
}

exports.logout = async (req, res) => {
    const key = req.query.key?.toString()
    let errormsg = null
    try {
        await withInstanceLock(key, async () => {
            await WhatsAppInstances[key]?.instance?.sock?.logout()
        })
    } catch (error) {
        errormsg = String(error?.message || error)
    }
    return res.json({
        error: false,
        status: 'LOGGED_OUT',
        message: `Logout requested for '${key}'. Pair again via /init + /qrbase64.`,
        action: 'call_init',
        errormsg: errormsg,
        key: key,
    })
}

exports.delete = async (req, res) => {
    const key = req.query.key?.toString()
    if (!key) {
        return res.status(400).json({
            error: true,
            status: 'MISSING_KEY',
            message: "Missing 'key' query param.",
            action: 'provide_key',
        })
    }
    let errormsg = null
    try {
        await withInstanceLock(key, async () => {
            const existing = WhatsAppInstances[key]
            try {
                existing?.teardownSocket?.()
            } catch (_) {
                // ignora
            }
            try {
                existing?.instance?.sock?.ev?.removeAllListeners()
            } catch (_) {
                // ignora
            }
            try {
                existing?.instance?.sock?.ws?.close()
            } catch (_) {
                // ignora
            }
            if (existing) await existing.deleteInstance(key)
            delete WhatsAppInstances[key]
        })
    } catch (error) {
        errormsg = String(error?.message || error)
    }
    return res.json({
        error: false,
        status: 'DELETED',
        message: `Instance '${key}' deleted. Create again with /init?key=${key}.`,
        action: 'call_init',
        data: errormsg,
        key: key,
    })
}

exports.list = async (req, res) => {
    if (req.query.active) {
        let instance = []
        const db = mongoClient.db('whatsapp-api')
        const result = await db.listCollections().toArray()
        result.forEach((collection) => {
            instance.push(collection.name)
        })

        return res.json({
            error: false,
            status: 'LISTED',
            message: 'All active instances (MongoDB collections).',
            action: 'none',
            data: instance,
        })
    }

    let instance = Object.keys(WhatsAppInstances).map(async (key) =>
        WhatsAppInstances[key].getInstanceDetail(key)
    )
    let data = await Promise.all(instance)

    return res.json({
        error: false,
        status: 'LISTED',
        message: 'All instances in this server memory. Empty means none created here yet or server restarted without restore.',
        action: data.length === 0 ? 'call_init' : 'none',
        count: data.length,
        data: data,
    })
}
