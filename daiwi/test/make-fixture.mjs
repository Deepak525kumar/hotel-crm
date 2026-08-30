/**
 * Builds a minimal but genuine .ipa for the end-to-end suite: a zip containing
 * Payload/HotelCRMWorker.app/{Info.plist, AppIcon60x60@2x.png}.
 *
 * Real enough to exercise the actual parser (src/lib/ipa.ts) rather than a stub —
 * an XML Info.plist is a legitimate alternative to the usual binary plist, and
 * the parser sniffs for both.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const out = process.argv[2] ?? "HotelCRMWorker.ipa";
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ipa-"));
const app = path.join(dir, "Payload", "HotelCRMWorker.app");
fs.mkdirSync(app, { recursive: true });

fs.writeFileSync(
  path.join(app, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>app.hotelcrm.worker</string>
  <key>CFBundleDisplayName</key><string>Hotel CRM Worker</string>
  <key>CFBundleShortVersionString</key><string>1.4.2</string>
  <key>CFBundleVersion</key><string>142</string>
  <key>MinimumOSVersion</key><string>16.0</string>
  <key>CFBundleSupportedPlatforms</key><array><string>iPhoneOS</string></array>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UIRequiredDeviceCapabilities</key><array><string>arm64</string></array>
</dict>
</plist>
`
);

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
  return Buffer.concat([len, body, crc]);
}
// Node < 22 has no zlib.crc32.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]))),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(app, "AppIcon60x60@2x.png"), png);

fs.rmSync(out, { force: true });
execFileSync("zip", ["-qr", path.resolve(out), "Payload"], { cwd: dir });
fs.rmSync(dir, { recursive: true, force: true });
console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
