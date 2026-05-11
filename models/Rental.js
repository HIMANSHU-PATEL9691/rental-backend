const mongoose = require('mongoose');
const { getNextSequence, generateId } = require('../utils/counterModel');
const { RentalStatus } = require('../types');
const Item = require('./Item');
const Customer = require('./Customer');

const rentalSchema = new mongoose.Schema({
  customId: { type: String, required: true, unique: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  itemNo: { type: String, default: '' },
  billNo: { type: String, default: '' },
  address: { type: String, default: '' },
  deliveryDate: { type: Date, default: null },
  discount: { type: Number, default: 0, min: 0 },
  penalty: { type: Number, default: 0, min: 0 },
  remark: { type: String, default: '' },
  remarkCompleted: { type: Boolean, default: false },
  remarkConfirmedBy: { type: String, default: '' },
  adminReconfirmed: { type: Boolean, default: false },
  adminReconfirmedBy: { type: String, default: '' },
  adminReconfirmedAt: { type: Date, default: null },
  advance: { type: Number, default: 0, min: 0 },
  securityAmount: { type: Number, default: 0, min: 0 },
  signature: { type: String, default: '' },
  returnedAt: { type: Date, default: null },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  total: { type: Number, required: true, min: 0 },
  status: { 
    type: String, 
    enum: Object.values(RentalStatus),
    default: RentalStatus.UPCOMING 
  }
}, {
  timestamps: true
});

rentalSchema.pre('validate', async function(next) {
  if (!this.customId) {
    const seq = await getNextSequence('R');
    this.customId = generateId('R', seq);
  }
  next();
});

module.exports = mongoose.model('Rental', rentalSchema);
