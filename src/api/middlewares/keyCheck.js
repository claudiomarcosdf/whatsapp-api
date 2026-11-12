function keyVerification(req, res, next) {
    const key = req.query['key']?.toString()

    if (!key) {
        return res.status(400).send({
            error: true,
            status: 'MISSING_KEY',
            message:
                "Missing 'key' query param. Example: /api/instance/info?key=190",
            action: 'provide_key',
            hint: 'Pass the same instance key used in /init?key=YOUR_KEY.',
        })
    }
    const instance = WhatsAppInstances[key]
    if (!instance) {
        return res.status(404).send({
            error: true,
            status: 'NOT_FOUND',
            message: `Instance '${key}' not found on this server. It may have never been created here or the server restarted without restore.`,
            action: 'call_init',
            hint: `Create it with GET /api/instance/init?key=${key}, then poll GET /api/instance/qrbase64?key=${key} every 3s.`,
            key: key,
        })
    }
    next()
}

module.exports = keyVerification
