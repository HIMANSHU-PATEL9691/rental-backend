const Rental = require('../models/Rental');
const Item = require('../models/Item');
const Customer = require('../models/Customer');
const { RentalStatus, ItemStatus } = require('../types');

// GET /api/rentals
exports.getRentals = async (req, res) => {
  try {
    const rentals = await Rental.find().populate('item customer').sort({ createdAt: -1 });
    res.json(rentals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/rentals/:id
exports.getRental = async (req, res) => {
  try {
    const rental = await Rental.findOne({ customId: req.params.id }).populate('item customer');
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    res.json(rental);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/rentals - complex: compute total, update item/customer
exports.createRental = async (req, res) => {
  try {
    const {
      itemId,
      customerId,
      billNo,
      address,
      itemNo,
      deliveryDate,
      startDate,
      endDate,
      discount = 0,
      penalty = 0,
      remark = '',
      advance = 0,
      securityAmount = 0,
      signature = '',
      total,
      status,
    } = req.body;

    // Frontend sends lowercase statuses; normalize defensively.
    let normalizedStatus = status;
    if (typeof normalizedStatus === 'string') {
      normalizedStatus = normalizedStatus.toLowerCase();
    }
    if (!normalizedStatus || !Object.values(RentalStatus).includes(normalizedStatus)) {
      // Default to UPCOMING if invalid/missing.
      normalizedStatus = RentalStatus.UPCOMING;
    }

    // Validate references
    const item = await Item.findOne({ customId: itemId });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const customer = await Customer.findOne({ customId: customerId });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const rental = new Rental({
      item: item._id,
      customer: customer._id,
      billNo,
      address,
      itemNo: itemNo || item.customId,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
      discount: Number(discount) || 0,
      penalty: Number(penalty) || 0,
      remark,
      advance: Number(advance) || 0,
      securityAmount: Number(securityAmount) || 0,
      signature,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      total: Number(total) || 0,
      status: normalizedStatus,
    });
    await rental.save();

    // Update item
    item.timesRented += 1;
    if (normalizedStatus === RentalStatus.ACTIVE) item.status = ItemStatus.RENTED;
    else if (normalizedStatus === RentalStatus.UPCOMING) item.status = ItemStatus.RESERVED;
    await item.save();

    // Update customer
    customer.rentals += 1;
    customer.totalSpent += Number(total) || 0;
    await customer.save();

    const populatedRental = await Rental.findById(rental._id).populate('item customer');
    res.status(201).json(populatedRental);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// PATCH /api/rentals/:id
exports.updateRental = async (req, res) => {
  try {
    const userRole = String(req.get('x-user-role') || req.headers['x-user-role'] || '')
      .trim()
      .toLowerCase();
    const updates = { ...req.body };
    const updateKeys = Object.keys(updates);

    if (typeof updates.remarkConfirmedBy === 'string') {
      updates.remarkConfirmedBy = updates.remarkConfirmedBy.trim();
    }
    if (typeof updates.adminReconfirmedBy === 'string') {
      updates.adminReconfirmedBy = updates.adminReconfirmedBy.trim();
    }
    if (updates.remarkCompleted != null) {
      updates.remarkCompleted = Boolean(updates.remarkCompleted);
    }
    if (updates.adminReconfirmed != null) {
      updates.adminReconfirmed = Boolean(updates.adminReconfirmed);
    }
    if (updates.adminReconfirmedAt) {
      updates.adminReconfirmedAt = new Date(updates.adminReconfirmedAt);
    }

    console.info('[rentals] update request', {
      id: req.params.id,
      userRole: userRole || '(missing)',
      updateKeys,
    });

    const allowedEmployeeUpdates = ['remarkCompleted', 'remarkConfirmedBy'];
    const isReadyUpdate = updateKeys.length > 0 && updateKeys.every(update => allowedEmployeeUpdates.includes(update));

    if (userRole === 'employee' || isReadyUpdate) {
      if (!isReadyUpdate) {
        return res.status(403).json({ error: 'Employees can only mark rentals as ready.' });
      }
      if (updates.remarkCompleted !== true || !updates.remarkConfirmedBy) {
        return res.status(400).json({ error: 'Employee name is required to mark a rental as ready.' });
      }
    } else if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    if (updates.adminReconfirmed === true && !updates.adminReconfirmedBy) {
      return res.status(400).json({ error: 'Admin name is required to reconfirm a rental.' });
    }

    if (updates && typeof updates.status === 'string') {
      updates.status = updates.status.toLowerCase();
      if (!Object.values(RentalStatus).includes(updates.status)) {
        delete updates.status;
      }
    }
    const rental = await Rental.findOne({ customId: req.params.id }).populate('item customer');
    if (!rental) return res.status(404).json({ error: 'Rental not found' });

    const oldStatus = rental.status;
    const oldPenalty = rental.penalty || 0;
    Object.assign(rental, updates);

    if (updates.penalty != null && rental.customer) {
      const penaltyDelta = Number(updates.penalty) - Number(oldPenalty);
      if (!Number.isNaN(penaltyDelta) && penaltyDelta !== 0) {
        rental.customer.totalSpent += penaltyDelta;
        await rental.customer.save();
      }
    }

    if (updates.status && updates.status !== oldStatus && rental.item) {
      if ([RentalStatus.ACTIVE, RentalStatus.OVERDUE].includes(updates.status)) {
        rental.item.status = ItemStatus.RENTED;
      } else if (updates.status === RentalStatus.UPCOMING) {
        rental.item.status = ItemStatus.RESERVED;
      } else if (updates.status === RentalStatus.RETURNED) {
        const otherOpenRental = await Rental.findOne({
          _id: { $ne: rental._id },
          item: rental.item._id,
          status: { $in: [RentalStatus.ACTIVE, RentalStatus.OVERDUE, RentalStatus.UPCOMING] },
        }).sort({ createdAt: -1 });

        if (otherOpenRental?.status === RentalStatus.ACTIVE || otherOpenRental?.status === RentalStatus.OVERDUE) {
          rental.item.status = ItemStatus.RENTED;
        } else if (otherOpenRental?.status === RentalStatus.UPCOMING) {
          rental.item.status = ItemStatus.RESERVED;
        } else {
          rental.item.status = ItemStatus.AVAILABLE;
        }
      }

      await rental.item.save();
    }

    await rental.save();
    const populatedRental = await Rental.findById(rental._id).populate('item customer');
    res.json(populatedRental);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// DELETE /api/rentals/:id
exports.deleteRental = async (req, res) => {
  try {
    // Find and populate to update counters if needed
    const rental = await Rental.findOne({ customId: req.params.id }).populate('item customer');
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    
    // Rollback counters and restore item availability when no open rentals remain.
    if (rental.item) {
      rental.item.timesRented = Math.max(0, rental.item.timesRented - 1);
      const remainingOpenRental = await Rental.findOne({
        _id: { $ne: rental._id },
        item: rental.item._id,
        status: { $in: [RentalStatus.ACTIVE, RentalStatus.UPCOMING] }
      });

      if (!remainingOpenRental) {
        rental.item.status = ItemStatus.AVAILABLE;
      } else if (remainingOpenRental.status === RentalStatus.ACTIVE) {
        rental.item.status = ItemStatus.RENTED;
      } else {
        rental.item.status = ItemStatus.RESERVED;
      }

      await rental.item.save();
    }
    if (rental.customer) {
      rental.customer.rentals = Math.max(0, rental.customer.rentals - 1);
      rental.customer.totalSpent = Math.max(0, rental.customer.totalSpent - rental.total);
      await rental.customer.save();
    }
    
    await Rental.findOneAndDelete({ customId: req.params.id });
    res.json({ message: 'Rental deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
