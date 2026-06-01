from dataclasses import dataclass
from typing import Literal

EventType = Literal["GRB", "GW", "FRB", "NU"]
Priority  = Literal["normal", "high"]


@dataclass(frozen=True)
class TopicMeta:
    event_type:  EventType
    observatory: str
    priority:    Priority


TOPICS = [
    "gcn.notices.chime.frb",
    "gcn.notices.einstein_probe.wxt.alert",
    "gcn.notices.icecube.lvk_nu_track_search",
    "gcn.notices.icecube.gold_bronze_track_alerts",
    "igwn.gwalert",
    "gcn.notices.swift.bat.guano",
]

TOPIC_METADATA: dict[str, TopicMeta] = {
    "gcn.notices.chime.frb": TopicMeta(
        event_type="FRB",
        observatory="CHIME",
        priority="normal",
    ),
    "gcn.notices.einstein_probe.wxt.alert": TopicMeta(
        event_type="GRB",
        observatory="Einstein Probe",
        priority="normal",
    ),
    "gcn.notices.icecube.lvk_nu_track_search": TopicMeta(
        event_type="NU",
        observatory="IceCube",
        priority="normal",
    ),
    "gcn.notices.icecube.gold_bronze_track_alerts": TopicMeta(
        event_type="NU",
        observatory="IceCube",
        priority="high",
    ),
    "igwn.gwalert": TopicMeta(
        event_type="GW",
        observatory="LIGO/Virgo/KAGRA",
        priority="high",
    ),
    "gcn.notices.swift.bat.guano": TopicMeta(
        event_type="GRB",
        observatory="Swift-BAT",
        priority="normal",
    ),
}


def get_topic_meta(topic: str) -> TopicMeta:
    """Return metadata for a topic, falling back to safe defaults."""
    return TOPIC_METADATA.get(
        topic,
        TopicMeta(event_type="GRB", observatory="Unknown", priority="normal"),
    )