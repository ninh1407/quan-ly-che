const express = require('express')
const router = express.Router()
const { vnToAction, execAction } = require('../bot-engine')
router.post('/chat', async (req, res) => {
  try {
    const text = String((req.body&&req.body.text)||'')
    const action = vnToAction(text)
    const r = await execAction(action)
    res.json(r)
  } catch (e) {
    res.status(500).json({ message:'Bot error', detail:String(e.message||'') })
  }
})
module.exports = router
