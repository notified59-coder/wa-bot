import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import http from 'http'
import QRCode from 'qrcode'

const KEYWORD = (process.env.KEYWORD || 'changeme').toLowerCase()
const AUTH_DIR = process.env.AUTH_DIR || './auth'
const PORT = process.env.PORT || 3000

let latestQR = null
let connected = false

// Tiny web page that shows the QR code
http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'text/html')
    if (connected) {
      res.end('<h2>Connected to WhatsApp. You can close this page.</h2>')
    } else if (latestQR) {
      const img = await QRCode.toDataURL(latestQR, { width: 320 })
      res.end(
        `<meta http-equiv="refresh" content="5">
         <h2>Scan this in WhatsApp > Linked devices > Link a device</h2>
         <img src="${img}">`
      )
    } else {
      res.end('<meta http-equiv="refresh" content="3"><h2>Starting... wait a few seconds</h2>')
    }
  })
  .listen(PORT, () => console.log('Web page running on port', PORT))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) latestQR = qr

    if (connection === 'open') {
      connected = true
      latestQR = null
      console.log('Connected to WhatsApp')
    }

    if (connection === 'close') {
      connected = false
      const code = lastDisconnect?.error?.output?.statusCode
      console.log('Connection closed. Reason code:', code)
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Change AUTH_DIR to a new name and redeploy.')
      } else {
        setTimeout(start, 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      const m = msg.message
      const text =
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        ''
      if (text.toLowerCase().includes(KEYWORD)) {
        try {
          await sock.chatModify(
            {
              deleteForMe: {
                deleteMedia: false,
                key: msg.key,
                timestamp: msg.messageTimestamp,
              },
            },
            msg.key.remoteJid
          )
          console.log('Deleted a message for me')
        } catch (e) {
          console.log('Delete failed:', e.message)
        }
      }
    }
  })
}

start()
