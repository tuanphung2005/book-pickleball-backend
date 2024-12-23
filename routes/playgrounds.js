const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// Get all playgrounds
router.get('/', async (req, res) => {
  try {
    const [playgrounds] = await pool.execute(
      `SELECT p.*, u.phone as ownerPhone 
       FROM playgrounds p 
       JOIN users u ON p.userId = u.id`
    );
    res.json(playgrounds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's playgrounds
router.get('/user', auth, async (req, res) => {
  try {
    const [playgrounds] = await pool.execute(
      'SELECT * FROM playgrounds WHERE userId = ?',
      [req.userId]
    );
    res.json(playgrounds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new playground (protected route)
router.post('/', auth, async (req, res) => {
  try {
    const { name, type, address, imageUrl, description } = req.body;

    // Validate URL length
    if (imageUrl.length > 500) {
      return res.status(400).json({ 
        error: 'URL hình ảnh quá dài (tối đa 500 ký tự)' 
      });
    }

    // Validate URL format
    try {
      new URL(imageUrl);
    } catch (err) {
      return res.status(400).json({ 
        error: 'URL hình ảnh không hợp lệ' 
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO playgrounds (name, type, address, imageUrl, description, userId) VALUES (?, ?, ?, ?, ?, ?)',
      [name, type, address, imageUrl, description, req.userId]
    );

    res.status(201).json({ 
      id: result.insertId, 
      name, 
      type, 
      address, 
      imageUrl,
      description 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update playground rating
router.patch('/:id/rating', auth, async (req, res) => {
  try {
    const { rating } = req.body;
    
    // Get current total ratings and count
    const [ratingResult] = await pool.execute(
      'SELECT AVG(rating) as avgRating FROM bookings WHERE playgroundId = ? AND rated = TRUE AND rating IS NOT NULL',
      [req.params.id]
    );

    const avgRating = ratingResult[0].avgRating || 0;

    // Update playground with average rating
    await pool.execute(
      'UPDATE playgrounds SET rating = ? WHERE id = ?',
      [avgRating, req.params.id]
    );
    
    // Update the booking's rating
    await pool.execute(
      'UPDATE bookings SET rated = TRUE, rating = ? WHERE id = ?',
      [rating, req.body.bookingId]
    );

    res.json({ message: 'Rating updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update playground
router.patch('/:id', auth, async (req, res) => {
  try {
    const { name, type, address, imageUrl, description } = req.body;
    
    // Check if playground belongs to user
    const [playground] = await pool.execute(
      'SELECT * FROM playgrounds WHERE id = ? AND userId = ?',
      [req.params.id, req.userId]
    );

    if (playground.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.execute(
      'UPDATE playgrounds SET name = ?, type = ?, address = ?, imageUrl = ?, description = ? WHERE id = ? AND userId = ?',
      [name, type, address, imageUrl, description, req.params.id, req.userId]
    );
    
    res.json({ 
      message: 'Playground updated successfully',
      playground: { id: req.params.id, name, type, address, imageUrl, description }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete playground
router.delete('/:id', auth, async (req, res) => {
  try {
    // First check if playground belongs to user
    const [playground] = await pool.execute(
      'SELECT * FROM playgrounds WHERE id = ? AND userId = ?',
      [req.params.id, req.userId]
    );

    if (playground.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Then delete
    await pool.execute(
      'DELETE FROM playgrounds WHERE id = ? AND userId = ?',
      [req.params.id, req.userId]
    );

    res.json({ message: 'Playground deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Report playground
router.post('/:id/report', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const playgroundId = req.params.id;

    // Check if user already reported this playground
    const [existing] = await pool.execute(
      'SELECT * FROM playground_reports WHERE playgroundId = ? AND userId = ?',
      [playgroundId, req.userId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Bạn đã báo cáo sân này rồi' });
    }

    // Add report
    await pool.execute(
      'INSERT INTO playground_reports (playgroundId, userId, reason) VALUES (?, ?, ?)',
      [playgroundId, req.userId, reason]
    );

    // Increment reports count and check threshold
    const [result] = await pool.execute(
      `UPDATE playgrounds 
       SET reports = reports + 1 
       WHERE id = ?`,
      [playgroundId]
    );

    // Check if playground should be removed
    const [playground] = await pool.execute(
      'SELECT reports FROM playgrounds WHERE id = ?',
      [playgroundId]
    );

    if (playground[0].reports >= 5) {
      await pool.execute(
        'UPDATE playgrounds SET isActive = FALSE WHERE id = ?',
        [playgroundId]
      );
    }

    res.json({ message: 'Report submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;