const express = require('express')
const controller = require('../controllers/client.controller')

const router = express.Router()
router.route('/test').get((req, res) => res.send('CLIENT OK...'))
router.route('/create').post(controller.create)

module.exports = router