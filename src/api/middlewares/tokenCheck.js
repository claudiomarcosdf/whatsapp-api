const config = require('../../config/config')
const jwt = require('jsonwebtoken');
const Client = require('../models/client.model')

const AUTH_SECRET = process.env.AUTH_SECRET;

//TOKEN TO VALID CLIENTS
function tokenVerification (req, res, next) {
    const bearer = req.headers.authorization
    const token = bearer?.slice(7)?.toString()
    if (!token) {
        return res.status(403).send({
            error: true,
            message: 'no bearer token header was present',
        })
    }

    jwt.verify(token, AUTH_SECRET, async function (err, decoded) {
        let client = null;
        if (decoded) client = await Client.findOne({ _id: decoded?._id }).exec();
        
        console.log(JSON.stringify(err))

        if (err || !client || !client.active) {
            return res
                .status(403)
                .send({ error: true, message: 'invalid bearer token supplied' })
        } else {
            next()
        }

    });

    // if (config.token !== token) {
    //     return res
    //         .status(403)
    //         .send({ error: true, message: 'invalid bearer token supplied' })
    // }
    //next()
}

module.exports = tokenVerification
