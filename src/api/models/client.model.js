const mongoose = require('mongoose')

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  document: { type: String, required: true, unique: true}, //cpf ou cnpj
  email: { type: String, required: true, unique: true },
  token: { type: String},
  active: { type: Boolean, default: true},
  createdAt: { type: Date, default: Date.now }
});

const Client = mongoose.model('Client', clientSchema)

module.exports = Client