"""Exercise the running API with real HTTP requests; creates a dedicated demo venue."""
import argparse
import json
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8080")
    parser.add_argument("--via-frontend", action="store_true",
                        help="Send browser-style POST requests through the frontend proxy.")
    args = parser.parse_args()
    base_url = args.url.rstrip("/")
    target = urlsplit(base_url)

    def request(method, path, body=None, expected=200):
        data = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        if args.via_frontend and method == "POST":
            headers["Origin"] = f"{target.scheme}://{target.netloc}"
        req = Request(base_url + path, data=data, method=method, headers=headers)
        try:
            response = urlopen(req, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            if response.code != expected:
                body = response.read().decode(errors="replace")
                raise RuntimeError(f"{method} {path}: expected {expected}, got {response.code}: {body}")
            return json.load(response)

    if not args.via_frontend:
        assert request("GET", "/actuator/health")["status"] == "UP"
    assert isinstance(request("GET", "/api/venues"), list)
    venue = request("POST", "/api/venues", {
        "name": "HTTP 冒烟验证场地", "location": "测试区", "capacity": 10,
        "openingTime": "08:00", "closingTime": "22:00", "status": "OPEN"
    }, 201)
    assert request("GET", f'/api/venues/{venue["id"]}') == venue
    payload = {"venueId": venue["id"], "organizer": "后端测试", "reservationDate": "2026-11-01",
               "startTime": "10:00", "endTime": "11:00", "purpose": "验证预约与持久化"}
    original = request("POST", "/api/reservations", payload, 201)
    assert request("POST", "/api/reservations", payload, 409)["error"]["code"] == "RESERVATION_CONFLICT"
    assert request("GET", f'/api/reservations/{original["id"]}')["status"] == "ACTIVE"
    assert request("POST", f'/api/reservations/{original["id"]}/cancel')["status"] == "CANCELLED"
    replacement = request("POST", "/api/reservations", payload, 201)
    records = request("GET", f'/api/reservations?venueId={venue["id"]}&status=ACTIVE')
    assert [record["id"] for record in records] == [replacement["id"]]
    print(json.dumps({"result": "PASS", "venueId": venue["id"],
                      "cancelledReservationId": original["id"],
                      "persistentReservationId": replacement["id"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
