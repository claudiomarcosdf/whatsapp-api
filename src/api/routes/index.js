const express = require('express')
const router = express.Router()
const apiRoutes = express.Router();
const apiClientRoutes = express.Router();
const { protectRoutes } = require('../../config/config')
const tokenApiCheck = require('../middlewares/tokenApiCheck')
const tokenCheck = require('../middlewares/tokenCheck')
const clientRoutes = require('./client.route')
const instanceRoutes = require('./instance.route')
const messageRoutes = require('./message.route')
const miscRoutes = require('./misc.route')
const groupRoutes = require('./group.route')

router.get('/status', (req, res) => res.send('OK'))
router.use('/api', apiRoutes);
router.use('/client', apiClientRoutes); //open

if (protectRoutes) {
  apiRoutes.use(tokenCheck); //private route
  apiRoutes.use('/instance', instanceRoutes)
  apiRoutes.use('/message', messageRoutes)
  apiRoutes.use('/group', groupRoutes)
  apiRoutes.use('/misc', miscRoutes)
  
  apiClientRoutes.use(tokenApiCheck);
} else {
  apiRoutes.use('/instance', instanceRoutes)
  apiRoutes.use('/message', messageRoutes)
  apiRoutes.use('/group', groupRoutes)
  apiRoutes.use('/misc', miscRoutes)
}

apiClientRoutes.use(clientRoutes);
module.exports = router
