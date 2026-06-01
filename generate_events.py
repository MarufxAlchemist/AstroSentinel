import json
import random
import datetime
import uuid

def generate_timestamp(start_year=2024, end_year=2025):
    start = datetime.datetime(start_year, 1, 1)
    end = datetime.datetime(end_year, 12, 31)
    dt = start + datetime.timedelta(seconds=random.randint(0, int((end - start).total_seconds())))
    return dt

def generate_astro_event(event_type, index):
    dt = generate_timestamp()
    dt_str = dt.isoformat() + "Z"
    
    event_id = f"{event_type}{dt.strftime('%y%m%d')}{chr(65 + (index % 26))}"
    
    ra = round(random.uniform(0, 360), 2)
    dec = round(random.uniform(-90, 90), 2)
    gal_lon = round(random.uniform(0, 360), 1)
    gal_lat = round(random.uniform(-90, 90), 1)
    sun_dist = round(random.uniform(30, 150), 1)
    moon_dist = round(random.uniform(30, 150), 1)
    latency_us = random.randint(10000, 50000)
    
    # Defaults
    observatory = "Unknown"
    fluence = None
    dm = None
    error_radius = round(random.uniform(0.1, 10.0), 2)
    snr = round(random.uniform(5.0, 50.0), 1)
    far = round(random.uniform(1e-8, 1e-2), 9)
    
    if event_type == "GRB":
        observatory = random.choice(["Fermi", "Swift"])
        fluence = round(random.uniform(1e-7, 1e-4), 8)
    elif event_type == "GW":
        observatory = "LIGO-Virgo-KAGRA"
        error_radius = round(random.uniform(10, 1000), 1)
    elif event_type == "FRB":
        observatory = "CHIME"
        dm = round(random.uniform(100, 2000), 1)
        
    return {
        "id": str(uuid.uuid4()),
        "eventId": event_id,
        "eventType": event_type,
        "observatory": observatory,
        "detectionTime": dt_str,
        "ra": ra,
        "dec": dec,
        "errorRadius": error_radius,
        "snr": snr,
        "far": far,
        "fluence": fluence,
        "dm": dm,
        "galLat": gal_lat,
        "galLon": gal_lon,
        "sunDistance": sun_dist,
        "moonDistance": moon_dist,
        "latencyUs": latency_us,
        "createdAt": dt_str
    }

events = []
for i in range(34): events.append(generate_astro_event("GRB", i))
for i in range(33): events.append(generate_astro_event("GW", i))
for i in range(33): events.append(generate_astro_event("FRB", i))

events.sort(key=lambda x: x["detectionTime"], reverse=True)

with open("historical_events.json", "w") as f:
    json.dump(events, f, indent=2)

print("Generated 100 flat events to historical_events.json")
