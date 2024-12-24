const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// Get user's bookings
router.get('/', auth, async (req, res) => {
  try {
    const [bookings] = await pool.execute(
      `SELECT b.*, p.name as playgroundName 
       FROM bookings b 
       JOIN playgrounds p ON b.playgroundId = p.id 
       WHERE b.userId = ?
       ORDER BY b.date DESC`,
      [req.userId]
    );
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get incoming bookings for playground owner
router.get('/incoming', auth, async (req, res) => {
  try {
    const [bookings] = await pool.execute(
      `SELECT b.*, p.name as playgroundName, u.name as userName
       FROM bookings b 
       JOIN playgrounds p ON b.playgroundId = p.id 
       JOIN users u ON b.userId = u.id
       WHERE p.userId = ? AND b.status = 'pending'
       ORDER BY b.date ASC`,
      [req.userId]
    );
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new booking
router.post('/', auth, async (req, res) => {
  try {
    const { playgroundId, date, timeStart, timeEnd } = req.body;
    
    // Validate required fields
    if (!playgroundId || !date || !timeStart || !timeEnd) {
      return res.status(400).json({ 
        error: 'Missing required fields: playgroundId, date, timeStart, timeEnd' 
      });
    }

    // Check if user owns the playground
    const [playground] = await pool.execute(
      'SELECT userId FROM playgrounds WHERE id = ?',
      [playgroundId]
    );

    if (playground.length > 0 && playground[0].userId === req.userId) {
      return res.status(400).json({ 
        error: 'Không thể đặt sân của chính mình' 
      });
    }

    // Check if timeslot is already booked - Fixed overlap logic
    const [existing] = await pool.execute(
      `SELECT * FROM bookings 
       WHERE playgroundId = ? 
       AND date = ? 
       AND status != 'cancelled'
       AND (
         (timeStart < ? AND timeEnd > ?) OR    /* New booking starts during existing */
         (timeStart < ? AND timeEnd > ?) OR    /* New booking ends during existing */
         (timeStart >= ? AND timeEnd <= ?)     /* Existing booking completely contains new */
       )`,
      [
        playgroundId, 
        date,
        timeEnd, timeStart,
        timeEnd, timeEnd,
        timeStart, timeEnd       
      ]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Khung giờ này đã được đặt' });
    }

    const [result] = await pool.execute(
      'INSERT INTO bookings (playgroundId, userId, date, timeStart, timeEnd) VALUES (?, ?, ?, ?, ?)',
      [playgroundId, req.userId, date, timeStart, timeEnd]
    );

    res.status(201).json({ 
      id: result.insertId,
      playgroundId,
      userId: req.userId,
      date,
      timeStart,
      timeEnd,
      status: 'pending'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel booking
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    // Check if booking exists and belongs to user
    const [booking] = await pool.execute(
      'SELECT * FROM bookings WHERE id = ? AND userId = ?',
      [req.params.id, req.userId]
    );

    if (booking.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking[0].status !== 'pending') {
      return res.status(400).json({ 
        error: 'Only pending bookings can be cancelled' 
      });
    }

    // Update booking status
    await pool.execute(
      'UPDATE bookings SET status = "cancelled" WHERE id = ?',
      [req.params.id]
    );

    res.json({ message: 'Booking cancelled successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Confirm booking
router.patch('/:id/confirm', auth, async (req, res) => {
  try {
    // Check if playground belongs to user
    const [booking] = await pool.execute(
      `SELECT b.*, p.userId as ownerId 
       FROM bookings b 
       JOIN playgrounds p ON b.playgroundId = p.id 
       WHERE b.id = ?`,
      [req.params.id]
    );

    if (booking.length === 0 || booking[0].ownerId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.execute(
      "UPDATE bookings SET status = 'confirmed' WHERE id = ?",
      [req.params.id]
    );

    res.json({ message: 'Booking confirmed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update playground rating and mark booking as rated
router.patch('/:id/rating', auth, async (req, res) => {
  try {
    const { rating, bookingId } = req.body;
    
    // Update the booking's rating first
    await pool.execute(
      'UPDATE bookings SET rated = TRUE, rating = ? WHERE id = ?',
      [rating, bookingId]
    );

    // Then calculate and update playground's average rating
    const [ratingResult] = await pool.execute(
      'SELECT AVG(rating) as avgRating FROM bookings WHERE playgroundId = ? AND rated = TRUE AND rating IS NOT NULL',
      [req.params.id]
    );

    const avgRating = ratingResult[0].avgRating || 0;

    // Update playground rating
    await pool.execute(
      'UPDATE playgrounds SET rating = ? WHERE id = ?',
      [avgRating, req.params.id]
    );

    res.json({ message: 'Rating updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;