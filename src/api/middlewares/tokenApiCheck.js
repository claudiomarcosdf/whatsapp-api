const config = require('../../config/config')

//API TOKEN TO CREATE/INVALIDATE CLIENTS
function tokenApiVerification (req, res, next) {
    const bearer = req.headers.authorization
    const tokenHeader = bearer?.slice(7)?.toString()
    const tokenParam = req.query.token;

    let token = null;

    if (!tokenHeader) {
        if (tokenParam) token = tokenParam;
    } else token = tokenHeader;
    
    if (!token) {
        return res.status(403).send({
            error: true,
            message: 'no bearer token header was present',
        })
    }

    if (config.token !== token) {
        return res
            .status(403)
            .send({ error: true, message: 'invalid bearer token supplied' })
    }
    next()
}

module.exports = tokenApiVerification