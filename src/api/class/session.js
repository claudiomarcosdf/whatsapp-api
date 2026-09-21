/* eslint-disable no-unsafe-optional-chaining */
const { WhatsAppInstance } = require('../class/instance')
const logger = require('pino')()
const config = require('../../config/config')

class Session {
    async restoreSessions() {
        let restoredSessions = new Array()
        let allCollections = []
        try {
            const db = mongoClient.db('whatsapp-api')
            const result = await db.listCollections().toArray()
            result.forEach((collection) => {
                allCollections.push(collection.name)
            })

            for (const key of allCollections) {
                try {
                    // Evita 2 sockets para a mesma key (restore + /init concorrente)
                    if (WhatsAppInstances[key]) {
                        restoredSessions.push(key)
                        continue
                    }
                    const webhook = !config.webhookEnabled
                        ? undefined
                        : config.webhookEnabled
                    const webhookUrl = !config.webhookUrl
                        ? undefined
                        : config.webhookUrl
                    const instance = new WhatsAppInstance(
                        key,
                        webhook,
                        webhookUrl
                    )
                    await instance.init()
                    WhatsAppInstances[key] = instance
                    restoredSessions.push(key)
                } catch (err) {
                    logger.error(`Error restoring session ${key}`)
                    logger.error(err)
                }
            }
        } catch (e) {
            logger.error('Error restoring sessions')
            logger.error(e)
        }
        return restoredSessions
    }
}

exports.Session = Session
