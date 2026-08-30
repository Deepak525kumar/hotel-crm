#!/usr/bin/env bash
# Full-flow regression for the Version Control service.
# Every assertion goes through a real HTTP request; database checks read the
# real rows. Nothing is faked.
set -uo pipefail

BASE="http://127.0.0.1:3002"
ADMIN="$BASE/version-control"
SP="$(dirname "$0")"
IPA="$SP/HotelCRMWorker.ipa"
PSQL="docker exec hotel-crm-postgres-1 psql -U hotelcrm -d version_control_dev -tAc"

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1 (got: $2)"; fail=$((fail+1)); }
check(){ [[ "$2" == *"$3"* ]] && ok "$1" || bad "$1" "$2"; }

J="$SP/e2e-cookies.txt"; rm -f "$J"
EMAIL="e2e-$RANDOM@example.com"
PW="e2e-passphrase-long-1"

echo "== accounts =="
code=$(curl -s -o /dev/null -w "%{http_code}" -c "$J" -X POST "$ADMIN/register" -d "email=$EMAIL" --data-urlencode "password=$PW")
check "register redirects" "$code" "302"
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$J" "$ADMIN/")
check "dashboard reachable with session" "$code" "200"
code=$(curl -s -o /dev/null -w "%{http_code}" "$ADMIN/")
check "dashboard rejects anonymous" "$code" "302"
body=$(curl -s -b "$J" "$ADMIN/account")
check "account shows the email" "$body" "$EMAIL"

echo "== upload =="
body=$(curl -s -b "$J" -X POST "$ADMIN/api/builds/upload" -F "file=@$IPA")
check "upload without a channel is refused" "$body" "development or production"

body=$(curl -s -b "$J" -X POST "$ADMIN/api/builds/upload" -F "channel=NONSENSE" -F "file=@$IPA")
check "unknown channel is refused" "$body" "development or production"

echo "not-a-zip" > "$SP/fake.ipa"
body=$(curl -s -b "$J" -X POST "$ADMIN/api/builds/upload" -F "channel=PRODUCTION" -F "file=@$SP/fake.ipa")
check "non-zip payload is refused" "$body" "Not a valid zip"

body=$(curl -s -b "$J" -X POST "$ADMIN/api/builds/upload" -F "channel=PRODUCTION" -F "file=@$SP/e2e.sh;filename=evil.txt")
check "wrong extension is refused" "$body" "Only .ipa and .apk"

PROD_ID=$(curl -s -b "$J" -X POST "$ADMIN/api/builds/upload" -F "channel=PRODUCTION" -F "notes=e2e" -F "file=@$IPA" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[[ -n "$PROD_ID" ]] && ok "production upload accepted" || bad "production upload accepted" "empty id"

DEV_ID=$(curl -s -b "$J" -X POST "$ADMIN/api/builds/upload" -F "channel=DEVELOPMENT" -F "file=@$IPA" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
sleep 4

body=$(curl -s -b "$J" "$ADMIN/api/builds")
check "parsed the real binary" "$body" '"version":"1.4.2"'
check "reached READY" "$body" '"status":"READY"'
check "min OS auto-detected" "$body" '"minOs":"iOS 16.0+"'
check "original filename kept" "$body" '"fileName":"HotelCRMWorker.ipa"'

echo "== history is written and permanent =="
n=$($PSQL "SELECT count(*) FROM \"ReleaseHistory\" WHERE \"uploadedByEmail\"='$EMAIL';")
check "history rows created" "$n" "2"

echo "== promotion guards =="
body=$(curl -s -b "$J" -X POST "$ADMIN/api/promote" -H 'Content-Type: application/json' \
  -d "{\"buildId\":\"$PROD_ID\",\"channel\":\"PRODUCTION\",\"platform\":\"ANDROID\"}")
check "iOS build refused by the Android box" "$body" "cannot go in the Android box"

body=$(curl -s -b "$J" -X POST "$ADMIN/api/promote" -H 'Content-Type: application/json' \
  -d "{\"buildId\":\"$DEV_ID\",\"channel\":\"PRODUCTION\",\"platform\":\"IOS\"}")
check "dev build refused by production" "$body" "cannot be promoted here"

body=$(curl -s -X POST "$ADMIN/api/promote" -H 'Content-Type: application/json' \
  -d "{\"buildId\":\"$PROD_ID\",\"channel\":\"PRODUCTION\",\"platform\":\"IOS\"}")
check "anonymous promote refused" "$body" "Session expired"

body=$(curl -s -b "$J" -X POST "$ADMIN/api/promote" -H 'Content-Type: application/json' \
  -d "{\"buildId\":\"$PROD_ID\",\"channel\":\"BOGUS\",\"platform\":\"IOS\"}")
check "unknown channel refused" "$body" "Unknown channel"

echo "== publishing =="
body=$(curl -s "$BASE/install")
check "nothing published before promotion" "$body" "No release published yet"

body=$(curl -s -b "$J" -X POST "$ADMIN/api/promote" -H 'Content-Type: application/json' \
  -d "{\"buildId\":\"$PROD_ID\",\"channel\":\"PRODUCTION\",\"platform\":\"IOS\"}")
check "valid promote succeeds" "$body" '"ok":true'

body=$(curl -s "$BASE/install")
check "catalogue now shows the app" "$body" "Hotel CRM Worker"
check "catalogue states the min OS" "$body" "Requires iOS 16.0+"

body=$(curl -s -b "$J" -X POST "$ADMIN/api/promote" -H 'Content-Type: application/json' \
  -d "{\"buildId\":\"$PROD_ID\",\"channel\":\"PRODUCTION\",\"platform\":\"IOS\"}")
check "re-promoting the same build is a no-op" "$body" '"unchanged":true'

SLUG=$($PSQL "SELECT b.slug FROM \"ReleaseSlot\" s JOIN \"Build\" b ON b.id=s.\"buildId\" WHERE s.channel='PRODUCTION' AND s.platform='IOS';" | tr -d ' ')
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/install/$SLUG")
check "per-build page is public" "$code" "200"

curl -s -o "$SP/e2e-dl.ipa" "$BASE/install/$SLUG/download"
a=$(shasum -a 256 "$IPA" | cut -d' ' -f1)
b=$(shasum -a 256 "$SP/e2e-dl.ipa" | cut -d' ' -f1)
[[ "$a" == "$b" ]] && ok "downloaded bytes are identical" || bad "downloaded bytes are identical" "$b"

code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/install/$SLUG/icon")
check "icon served" "$code" "200"

body=$(curl -s "$BASE/install/$SLUG/manifest.plist")
check "manifest refuses a non-https origin" "$body" "requires an HTTPS origin"

echo "== dev channel never leaks into the public page =="
DEV_SLUG=$($PSQL "SELECT slug FROM \"Build\" WHERE id='$DEV_ID';" | tr -d ' ')
body=$(curl -s -b "$J" -X POST "$ADMIN/api/promote" -H 'Content-Type: application/json' \
  -d "{\"buildId\":\"$DEV_ID\",\"channel\":\"DEVELOPMENT\",\"platform\":\"IOS\"}")
check "dev build promotes on the dev board" "$body" '"ok":true'
body=$(curl -s "$BASE/install")
n=$(echo "$body" | grep -c "$DEV_SLUG")
[[ "$n" == "0" ]] && ok "dev build absent from the workers' page" || bad "dev build absent from the workers' page" "$n"

echo "== security headers =="
h=$(curl -s -D- -o /dev/null "$BASE/install")
check "CSP present" "$h" "default-src 'none'"
check "noindex present" "$h" "noindex"
check "nosniff present" "$h" "nosniff"
check "frame denied" "$h" "DENY"

echo "== deletion keeps history, drops the binary =="
curl -s -b "$J" -X DELETE "$ADMIN/api/builds/$PROD_ID" > /dev/null
n=$($PSQL "SELECT count(*) FROM \"ReleaseSlot\" WHERE channel='PRODUCTION';")
check "slot cleared on delete" "$n" "0"
n=$($PSQL "SELECT count(*) FROM \"ReleaseHistory\" WHERE \"uploadedByEmail\"='$EMAIL';")
check "history survives deletion" "$n" "2"
n=$($PSQL "SELECT count(*) FROM \"ReleaseHistory\" WHERE \"binaryDeletedBy\"='$EMAIL';")
check "deletion is stamped on the history row" "$n" "1"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/install/$SLUG")
check "deleted build's link 404s" "$code" "404"

echo "== password change revokes other sessions =="
J2="$SP/e2e-cookies2.txt"; rm -f "$J2"
curl -s -o /dev/null -c "$J2" -X POST "$ADMIN/login" -d "email=$EMAIL" --data-urlencode "password=$PW"
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$J2" "$ADMIN/")
check "second session works" "$code" "200"
curl -s -o /dev/null -b "$J" -c "$J" -X POST "$ADMIN/account/password" \
  --data-urlencode "currentPassword=$PW" --data-urlencode "newPassword=changed-passphrase-77" --data-urlencode "confirmPassword=changed-passphrase-77"
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$J2" "$ADMIN/")
check "other session revoked" "$code" "302"
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$J" "$ADMIN/")
check "changer stays signed in" "$code" "200"

echo
echo "=============================="
echo "  passed: $pass   failed: $fail"
echo "=============================="
[[ $fail -eq 0 ]]
