const jwt = require('jsonwebtoken');
const Client = require('../models/client.model')
const logger = require('pino')()
const documentValid = require('../helper/documentValid')

const AUTH_SECRET = process.env.AUTH_SECRET;
const emailRegex = /\S+@\S+\.\S+/;

exports.create = async (req, res) => {
  const name = req.body.name || '';
  const document = req.body.document || '';
  const email = req.body.email || '';
  
  if (!email.match(emailRegex)) {
    return res.status(400)
      .send({ error: true, message: 'Invalid email' });
  }

  if (!documentValid(document)) {
    return res.status(400)
      .send({ error: true, message: 'Invalid document' });    
  }

  let data
  try {
    let client = await Client.findOne({ email }).exec();
    if (!client) {
      const newClient = new Client({
        name,
        document,
        email
      })
      
      const clientSaved = await newClient.save();
      const jwtToken = jwt.sign(clientSaved.toJSON(), AUTH_SECRET, {});
      data = await Client.findByIdAndUpdate(
        { _id: clientSaved.id },
        { token: jwtToken },
        { new: true }
      );

      res.status(200).json({
        error: false,
        message: 'Client saved',
        data: data
      })      

    } else res.status(400).json({
      error: true,
      message:
          'Client exists: ' + client.name,
      data: {}
    })

  } catch (error) {
    console.log(error)
    logger.error('Error create client ', error)
  }
}

