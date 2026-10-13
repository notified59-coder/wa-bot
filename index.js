import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys'
import pino from 'pino'

const KEYWORD = (process.env.KEYWORD || 'changeme').toLowerCase()
const PHONE = (process.env.PHONE_NUMBER || '').replace(/\D/g, '')
const AUTH_DIR = process.env.AUTH_DIR || './auth'

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  let pairingRequested = false

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    // WhatsApp is ready for pairing: ask for the code (once)
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true
      try {
        const code = await sock.requestPairingCode(PHONE)
        console.log('=====================================')
        console.log('PAIRING CODE:', code)
        console.log('=====================================')
      } catch (e) {
        console.log('Could not get pairing code:', e.message)
      }
    }

    if (connection === 'open') console.log('Connected to WhatsApp')

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      console.log('Connection closed. Reason code:', code)
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Unlink the device and re-pair.')
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
