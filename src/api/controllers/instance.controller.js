const { WhatsAppInstance } = require('../class/instance')
const fs = require('fs')
const path = require('path')
const config = require('../../config/config')
const { Session } = require('../class/session')

exports.init = async (req, res) => {
    const key = req.query.key
    let instanceCheck = WhatsAppInstances[key]

    /**
     * Check if exists connected phone
     * Error sending message if an instance with a connected phone already exists and another instance is created.
     */
    if (instanceCheck) {
        const instanceData = await instanceCheck.getInstanceDetail(key)
        if (instanceData?.phone_connected) {
            return res.json({
                error: false,
                message: 'Phone connected to the created instance',
                instance_data: instanceData,
            })
        }
    }

    const webhook = !req.query.webhook ? false : req.query.webhook
    const webhookUrl = !req.query.webhookUrl ? null : req.query.webhookUrl
    const appUrl = config.appUrl || req.protocol + '://' + req.headers.host
    const instance = new WhatsAppInstance(key, webhook, webhookUrl)
    const data = await instance.init()
    WhatsAppInstances[data.key] = instance
    res.json({
        error: false,
        message: 'Initializing successfully',
        key: data.key,
        webhook: {
            enabled: webhook,
            webhookUrl: webhookUrl,
        },
        qrcode: {
            url: appUrl + '/instance/qr?key=' + data.key,
        },
        browser: config.browser,
    })
}

exports.qr = async (req, res) => {
    try {
        const qrcode =
            WhatsAppInstances[req.query.key]?.instance.qr ?? ''
        res.render('qrcode', {
            qrcode: qrcode,
        })
    } catch {
        res.json({
            qrcode: '',
        })
    }
}

exports.qrbase64 = async (req, res) => {
    try {
        const instance = WhatsAppInstances[req.query.key]
        const qrcode = instance?.instance?.qr ?? ''
        const online = !!instance?.instance?.online
        const qrRetry = instance?.instance?.qrRetry ?? 0
        const maxRetry = Number(config.instance.maxRetryQr)

        // Ja conectado: nao ha QR a escanear (evita falso sucesso com "")
        if (online) {
            return res.json({
                error: false,
                message: 'Phone connected, QR not needed',
                qrcode: '',
                connected: true,
                online: online,
                qrRetry: qrRetry,
                maxRetry: maxRetry,
            })
        }

        // QR valido disponivel
        if (qrcode && qrcode.trim() !== '') {
            return res.json({
                error: false,
                message: 'QR Base64 fetched successfully',
                qrcode: qrcode,
                connected: false,
                online: online,
                qrRetry: qrRetry,
                maxRetry: maxRetry,
            })
        }

        // QR expirado pelo maxRetry (instance.js seta ' ' ao encerrar)
        if (qrRetry >= maxRetry) {
            return res.json({
                error: true,
                message:
                    'QR expired, call /instance/init with the same key to generate a new one',
                qrcode: '',
                connected: false,
                online: online,
                qrRetry: qrRetry,
                maxRetry: maxRetry,
                expired: true,
            })
        }

        // QR ainda nao gerado (race entre /init e evento qr do Baileys)
        return res.json({
            error: true,
            message: 'QR not ready yet, try again in a few seconds',
            qrcode: '',
            connected: false,
            online: online,
            qrRetry: qrRetry,
            maxRetry: maxRetry,
        })
    } catch {
        res.json({
            error: true,
            message: 'Unable to fetch QR',
            qrcode: '',
        })
    }
}

exports.info = async (req, res) => {
    const instance = WhatsAppInstances[req.query.key]
    let data
    try {
        data = await instance.getInstanceDetail(req.query.key)
    } catch (error) {
        data = {
            instance_key: req.query.key,
            phone_connected: false,
            webhookUrl: null,
            user: {},
        }
    }
    // Garante formato estavel: phone_connected sempre boolean, user sempre objeto
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
        message: 'Instance fetched successfully',
        instance_data: data,
    })
}

exports.restore = async (req, res, next) => {
    try {
        const session = new Session()
        let restoredSessions = await session.restoreSessions()
        return res.json({
            error: false,
            message: 'All instances restored',
            data: restoredSessions,
        })
    } catch (error) {
        next(error)
    }
}

exports.logout = async (req, res) => {
    let errormsg
    try {
        await WhatsAppInstances[req.query.key].instance?.sock?.logout()
    } catch (error) {
        errormsg = error
    }
    return res.json({
        error: false,
        message: 'logout successfull',
        errormsg: errormsg ? errormsg : null,
    })
}

exports.delete = async (req, res) => {
    let errormsg
    try {
        await WhatsAppInstances[req.query.key].deleteInstance(req.query.key)
        delete WhatsAppInstances[req.query.key]
    } catch (error) {
        errormsg = error
    }
    return res.json({
        error: false,
        message: 'Instance deleted successfully',
        data: errormsg ? errormsg : null,
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
            message: 'All active instance',
            data: instance,
        })
    }

    let instance = Object.keys(WhatsAppInstances).map(async (key) =>
        WhatsAppInstances[key].getInstanceDetail(key)
    )
    let data = await Promise.all(instance)

    return res.json({
        error: false,
        message: 'All instance listed',
        data: data,
    })
}
