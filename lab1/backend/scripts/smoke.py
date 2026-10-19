"""Exercise the running API with real HTTP requests; creates a dedicated demo venue."""
import argparse
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8080")
    args = parser.parse_args()

    def request(method, path, body=None, expected=200):
        data = None if body is None else json.dumps(body).encode()
        req = Request(args.url.rstrip("/") + path, data=data, method=method,
                      headers={"Content-Type": "application/json"})
        try:
            response = urlopen(req, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            result = json.load(response)
            if response.code != expected:
                raise RuntimeError(f"{method} {path}: expected {expected}, got {response.code}: {result}")
            return result

    assert request("GET", "/actuator/health")["status"] == "UP"
    venue = request("POST", "/api/venues", {
        "name": "HTTP 冒烟验证场地", "location": "测试区", "capacity": 10,
        "openingTime": "08:00", "closingTime": "22:00", "status": "OPEN"
    }, 201)
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
