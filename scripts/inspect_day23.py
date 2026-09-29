import urllib.request
import json

req = urllib.request.Request('http://45.205.25.3:8090/api/auth/login', data=json.dumps({'username':'admin','password':'0000'}).encode(), headers={'Content-Type':'application/json'})
res = urllib.request.urlopen(req)
token = json.loads(res.read())['token']

req2 = urllib.request.Request('http://45.205.25.3:8090/api/memos?startMonth=2026-08&months=3', headers={'Authorization': 'Bearer ' + token})
res2 = urllib.request.urlopen(req2)
memos = json.loads(res2.read())['memos']

for m in memos:
    if '[结转]' in m['title'] or '结转' in m['title'] or m['date'] == '2026-09-23':
        print(f"ID: {m['id']}, Date: {m['date']}, Title: {m['title']}, Owner: {m.get('ownerId')}, OwnerName: {m.get('ownerName')}")
