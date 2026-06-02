const { princeId, removeFile } = require('../mayel');
const QRCode = require('qrcode');
const express = require('express');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const pino = require("pino");
const { sendButtons } = require('gifted-btns');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    delay,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "session");

router.get('/', async (req, res) => {
    const id = princeId();

    let responseSent = false;
    let sessionCleanedUp = false;

    const cleanUpSession = async () => {
        if (!sessionCleanedUp) {
            await removeFile(path.join(sessionDir, id));
            sessionCleanedUp = true;
        }
    };

    const sendResponseOnce = (html) => {
        if (!responseSent && !res.headersSent) {
            res.send(html);
            responseSent = true;
        }
    };

    const startConnection = async () => {
        const { version } = await fetchLatestBaileysVersion();

        const { state, saveCreds } = await useMultiFileAuthState(
            path.join(sessionDir, id)
        );

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Desktop"),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // ================= QR CODE =================
            if (qr && !responseSent) {
                const qrImage = await QRCode.toDataURL(qr);

                sendResponseOnce(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>QR CODE</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="background:#000;color:#fff;text-align:center;padding:20px">
                        <h2>Scan QR Code</h2>
                        <img src="${qrImage}" style="width:300px;height:300px;background:#fff;padding:10px;border-radius:15px;" />
                        <p>Scan with WhatsApp</p>
                    </body>
                    </html>
                `);
            }

            // ================= CONNECTED =================
            if (connection === "open") {
                try {
                    // IMPORTANT FIX: allow Baileys to flush creds properly
                    await delay(15000);

                    const credsPath = path.join(sessionDir, id, "creds.json");

                    if (!fs.existsSync(credsPath)) {
                        throw new Error("Session file not found");
                    }

                    const sessionFile = fs.readFileSync(credsPath, "utf-8");

                    if (!sessionFile || sessionFile.length < 100) {
                        throw new Error("Invalid session file");
                    }

                    const compressed = zlib.gzipSync(sessionFile);
                    const base64 = compressed.toString("base64");

                    await sendButtons(sock, sock.user.id, {
                        text: "HAYWHY_MDX!" + base64,
                        footer: "*Powered by ‎⁨👾𝒟𝐸𝒱-𝐻𝒜𝒴𝒲𝐻𝒴//𝒯𝐸𝒞𝐻🤖⁩*",
                        buttons: [
                            {
                                name: "cta_copy",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "Copy Session",
                                    copy_code: "HAYWHY_MDX!" + base64
                                })
                            },
                            {
                                name: "cta_url",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "GitHub",
                                    url: "https://github.com/HayMosh1116/HAYMOSH_MDX/"
                                })
                            }
                        ]
                    });

                    await delay(3000);
                    await sock.ws.close();

                } catch (err) {
                    console.error("Session generation error:", err);
                } finally {
                    await cleanUpSession();
                }
            }

            // ================= RECONNECT =================
            else if (
                connection === "close" &&
                lastDisconnect?.error?.output?.statusCode !== 401
            ) {
                console.log("Reconnecting...");
                await delay(8000);
                startConnection();
            }
        });
    };

    try {
        await startConnection();
    } catch (err) {
        console.error("Fatal error:", err);

        if (!responseSent) {
            res.status(500).json({
                code: "QR Service Unavailable"
            });
        }

        await cleanUpSession();
    }
});

module.exports = router;
