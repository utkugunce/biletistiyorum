# -*- coding: utf-8 -*-
"""
TVF Ziraat Bankkart (Başkent) Voleybol Salonu
Tüm Tribün Blokları ve Koltuk Düzeni Veritabanı
"""

from typing import Dict, List, Any, Optional

# Satışa kapalı (Kırmızı) bloklar
CLOSED_BLOCKS = {
    "107": {"id": "107", "name": "107 BLOK", "zone": "east_lower", "reason": "Satışa Kapalı"},
    "115": {"id": "115", "name": "115 BLOK", "zone": "north_lower", "reason": "Satışa Kapalı"},
    "116": {"id": "116", "name": "116 BLOK", "zone": "west_lower", "reason": "Satışa Kapalı"},
    "201": {"id": "201", "name": "201 PROTOKOL", "zone": "south_upper", "reason": "Protokol (Satışa Kapalı)"},
    "202": {"id": "202", "name": "202 VIP", "zone": "south_upper", "reason": "VIP (Satışa Kapalı)"},
    "217": {"id": "217", "name": "217 BLOK", "zone": "south_upper", "reason": "Satışa Kapalı"},
    "218": {"id": "218", "name": "218 VIP", "zone": "south_upper", "reason": "VIP (Satışa Kapalı)"},
}

# Salon yerleşim bölgeleri (Arena haritası için)
ARENA_ZONES = {
    "north_upper": ["213", "212", "211", "210", "209", "208", "207", "206"],
    "north_lower": ["115", "114", "113", "112", "111", "110", "109", "108"],
    "west_upper": ["214", "215", "216"],
    "west_lower": ["116", "117", "118"],
    "east_lower": ["107", "106", "105"],
    "east_upper": ["205", "204", "203"],
    "south_lower": ["120", "121", "102", "103", "104"],
    "south_upper": ["217", "218", "201", "202"],
}


def _desc(n: int) -> List[int]:
    """N..1 azalan koltuk listesi"""
    return list(range(n, 0, -1))


def _asc(n: int) -> List[int]:
    """1..N artan koltuk listesi"""
    return list(range(1, n + 1))


def _pad_left(seats: List[Optional[int]], total_cols: int) -> List[Optional[int]]:
    """Sağa hizalamak için sola None (boşluk) ekler."""
    pad = max(0, total_cols - len(seats))
    return ([None] * pad) + list(seats)


def _pad_right(seats: List[Optional[int]], total_cols: int) -> List[Optional[int]]:
    """Sola hizalamak için sağa None (boşluk) ekler."""
    pad = max(0, total_cols - len(seats))
    return list(seats) + ([None] * pad)


def _build_all_blocks() -> Dict[str, Dict[str, Any]]:
    blocks: Dict[str, Dict[str, Any]] = {}

    # ---------------------------------------------------------
    # GÜNEY ALT TRİBÜN (Saha Üstte, Sıralar yukarıdan aşağı 3->9 veya 1->5, Koltuklar Sağdan Sola N..1)
    # ---------------------------------------------------------
    # 102 BLOK: Sıra 3..8 (15..1), Sıra 9 (16..1) -> Sağa hizalı (16 sütun)
    blocks["102"] = {
        "id": "102",
        "name": "102 BLOK",
        "zone": "south_lower",
        "court_side": "top",
        "cols": 16,
        "rows": [
            {"row": r, "cells": _pad_left(_desc(15), 16)} for r in range(3, 9)
        ] + [
            {"row": 9, "cells": _desc(16)}
        ],
    }

    # 103 BLOK: Sıra 3..8 (13..1), Sıra 9 (15..1) -> Sağa hizalı (15 sütun)
    blocks["103"] = {
        "id": "103",
        "name": "103 BLOK",
        "zone": "south_lower",
        "court_side": "top",
        "cols": 15,
        "rows": [
            {"row": r, "cells": _pad_left(_desc(13), 15)} for r in range(3, 9)
        ] + [
            {"row": 9, "cells": _desc(15)}
        ],
    }

    # 104 BLOK: Sıra 1..5, Sola hizalı, N..1
    r104_counts = {1: 7, 2: 10, 3: 11, 4: 7, 5: 15}
    blocks["104"] = {
        "id": "104",
        "name": "104 BLOK",
        "zone": "south_lower",
        "court_side": "top",
        "cols": 15,
        "rows": [
            {"row": r, "cells": _pad_right(_desc(cnt), 15)} for r, cnt in r104_counts.items()
        ],
    }

    # 120 BLOK: Sıra 3..8 (13..1), Sıra 9 (12..1, sağa hizalı)
    blocks["120"] = {
        "id": "120",
        "name": "120 BLOK",
        "zone": "south_lower",
        "court_side": "top",
        "cols": 13,
        "rows": [
            {"row": r, "cells": _desc(13)} for r in range(3, 9)
        ] + [
            {"row": 9, "cells": _pad_left(_desc(12), 13)}
        ],
    }

    # 121 BLOK: Sıra 3..8 (23..1), Sıra 9 (22..1, sağa hizalı)
    blocks["121"] = {
        "id": "121",
        "name": "121 BLOK",
        "zone": "south_lower",
        "court_side": "top",
        "cols": 23,
        "rows": [
            {"row": r, "cells": _desc(23)} for r in range(3, 9)
        ] + [
            {"row": 9, "cells": _pad_left(_desc(22), 23)}
        ],
    }

    # ---------------------------------------------------------
    # DOĞU ALT TRİBÜN (105, 106) - Sıra 9..3, Soldan Sağa 1..N
    # ---------------------------------------------------------
    # 105 BLOK: R9: [1, None*6, 8..16, None], R8..R3: 1..17
    r105_9: List[Optional[int]] = [1] + ([None] * 6) + list(range(8, 17)) + [None]
    blocks["105"] = {
        "id": "105",
        "name": "105 BLOK",
        "zone": "east_lower",
        "court_side": "left",
        "cols": 17,
        "rows": [{"row": 9, "cells": r105_9}] + [
            {"row": r, "cells": _asc(17)} for r in range(8, 2, -1)
        ],
    }

    # 106 BLOK: R9: [1, None*6, 8..17, None], R8..R3: 1..18
    r106_9: List[Optional[int]] = [1] + ([None] * 6) + list(range(8, 18)) + [None]
    blocks["106"] = {
        "id": "106",
        "name": "106 BLOK",
        "zone": "east_lower",
        "court_side": "left",
        "cols": 18,
        "rows": [{"row": 9, "cells": r106_9}] + [
            {"row": r, "cells": _asc(18)} for r in range(8, 2, -1)
        ],
    }

    # ---------------------------------------------------------
    # KUZEY ALT TRİBÜN (108..114) - Sıra 9..4 (108 için 5..2), Soldan Sağa 1..N
    # ---------------------------------------------------------
    r108_counts = {5: 17, 4: 7, 3: 12, 2: 10}
    blocks["108"] = {
        "id": "108",
        "name": "108 BLOK",
        "zone": "north_lower",
        "court_side": "bottom",
        "cols": 17,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(cnt), 17)} for r, cnt in r108_counts.items()
        ],
    }

    blocks["109"] = {
        "id": "109",
        "name": "109 BLOK",
        "zone": "north_lower",
        "court_side": "bottom",
        "cols": 14,
        "rows": [{"row": 9, "cells": _pad_right(_asc(13), 14)}] + [
            {"row": r, "cells": _asc(14)} for r in range(8, 3, -1)
        ],
    }

    blocks["110"] = {
        "id": "110",
        "name": "110 BLOK",
        "zone": "north_lower",
        "court_side": "bottom",
        "cols": 22,
        "rows": [{"row": 9, "cells": _pad_right(_asc(21), 22)}] + [
            {"row": r, "cells": _asc(22)} for r in range(8, 3, -1)
        ],
    }

    blocks["111"] = {
        "id": "111",
        "name": "111 BLOK",
        "zone": "north_lower",
        "court_side": "bottom",
        "cols": 8,
        "rows": [{"row": 9, "cells": _pad_right(_asc(7), 8)}] + [
            {"row": r, "cells": _asc(8)} for r in range(8, 3, -1)
        ],
    }

    blocks["112"] = {
        "id": "112",
        "name": "112 BLOK",
        "zone": "north_lower",
        "court_side": "bottom",
        "cols": 7,
        "rows": [{"row": r, "cells": _asc(7)} for r in range(9, 3, -1)],
    }

    blocks["113"] = {
        "id": "113",
        "name": "113 BLOK",
        "zone": "north_lower",
        "court_side": "bottom",
        "cols": 24,
        "rows": [{"row": 9, "cells": _pad_right(_asc(23), 24)}] + [
            {"row": r, "cells": _asc(24)} for r in range(8, 3, -1)
        ],
    }

    blocks["114"] = {
        "id": "114",
        "name": "114 BLOK",
        "zone": "north_lower",
        "court_side": "bottom",
        "cols": 14,
        "rows": [{"row": r, "cells": _asc(14)} for r in range(9, 3, -1)],
    }

    # ---------------------------------------------------------
    # BATI ALT TRİBÜN (117, 118) - Sıra 9..3, Soldan Sağa 1..N
    # ---------------------------------------------------------
    blocks["117"] = {
        "id": "117",
        "name": "117 BLOK",
        "zone": "west_lower",
        "court_side": "right",
        "cols": 18,
        "rows": [{"row": 9, "cells": _pad_right(_asc(17), 18)}] + [
            {"row": r, "cells": _asc(18)} for r in range(8, 2, -1)
        ],
    }

    blocks["118"] = {
        "id": "118",
        "name": "118 BLOK",
        "zone": "west_lower",
        "court_side": "right",
        "cols": 8,
        "rows": [{"row": r, "cells": _asc(8)} for r in range(9, 2, -1)],
    }

    # ---------------------------------------------------------
    # DOĞU ÜST TRİBÜN (203, 204, 205)
    # ---------------------------------------------------------
    # 203 BLOK: Sıra 1..10 yukarıdan aşağı, Sağa hizalı N..1
    r203_counts = {1: 17, 2: 19, 3: 23, 4: 25, 5: 29, 6: 40, 7: 42, 8: 45, 9: 32, 10: 25}
    blocks["203"] = {
        "id": "203",
        "name": "203 BLOK",
        "zone": "east_upper",
        "court_side": "left",
        "cols": 45,
        "rows": [
            {"row": r, "cells": _pad_left(_desc(cnt), 45)} for r, cnt in r203_counts.items()
        ],
    }

    # 204 BLOK: Sıra 8..1, Soldan Sağa 1..N (R8..R6: 25, R5..R1: 18)
    blocks["204"] = {
        "id": "204",
        "name": "204 BLOK",
        "zone": "east_upper",
        "court_side": "left",
        "cols": 25,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(25 if r >= 6 else 18), 25)}
            for r in range(8, 0, -1)
        ],
    }

    # 205 BLOK: Sıra 8..1, Soldan Sağa 1..N (R8..R7: 22, R6: 25, R5..R1: 18)
    r205_counts = {8: 22, 7: 22, 6: 25, 5: 18, 4: 18, 3: 18, 2: 18, 1: 18}
    blocks["205"] = {
        "id": "205",
        "name": "205 BLOK",
        "zone": "east_upper",
        "court_side": "left",
        "cols": 25,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r205_counts[r]), 25)}
            for r in range(8, 0, -1)
        ],
    }

    # ---------------------------------------------------------
    # KUZEY ÜST TRİBÜN (206..213) - Sıra 10..1, Soldan Sağa 1..N
    # ---------------------------------------------------------
    r206_counts = {10: 21, 9: 27, 8: 45, 7: 41, 6: 38, 5: 28, 4: 25, 3: 22, 2: 19, 1: 17}
    blocks["206"] = {
        "id": "206",
        "name": "206 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 45,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r206_counts[r]), 45)}
            for r in range(10, 0, -1)
        ],
    }

    r207_counts = {10: 10, 9: 10, 8: 18, 7: 18, 6: 18, 5: 11, 4: 11, 3: 11, 2: 11, 1: 11}
    blocks["207"] = {
        "id": "207",
        "name": "207 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 18,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r207_counts[r]), 18)}
            for r in range(10, 0, -1)
        ],
    }

    r208_counts = {10: 10, 9: 10, 8: 16, 7: 16, 6: 16, 5: 9, 4: 9, 3: 9, 2: 9, 1: 9}
    blocks["208"] = {
        "id": "208",
        "name": "208 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 16,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r208_counts[r]), 16)}
            for r in range(10, 0, -1)
        ],
    }

    r209_counts = {10: 10, 9: 10, 8: 8, 7: 8, 6: 8, 5: 8, 4: 8, 3: 8, 2: 8, 1: 8}
    blocks["209"] = {
        "id": "209",
        "name": "209 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 10,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r209_counts[r]), 10)}
            for r in range(10, 0, -1)
        ],
    }

    r210_counts = {10: 5, 9: 5, 8: 8, 7: 7, 6: 9, 5: 9, 4: 9, 3: 9, 2: 9, 1: 9}
    blocks["210"] = {
        "id": "210",
        "name": "210 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 9,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r210_counts[r]), 9)}
            for r in range(10, 0, -1)
        ],
    }

    # 211 BLOK: R10 ve R9'da boşluklu yapı: 4 boş, 1..5, 3 boş, 6..10 (17 sütun)
    r211_top: List[Optional[int]] = ([None] * 4) + list(range(1, 6)) + ([None] * 3) + list(range(6, 11))
    blocks["211"] = {
        "id": "211",
        "name": "211 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 17,
        "rows": [
            {"row": 10, "cells": r211_top},
            {"row": 9, "cells": list(r211_top)},
        ] + [
            {"row": r, "cells": _pad_right(_asc(16 if r >= 6 else 9), 17)}
            for r in range(8, 0, -1)
        ],
    }

    # 212 BLOK: R10 & R9: 1..5, 2 boş, 8..10, 1 boş, 11..15, 2 boş (18 sütun)
    # R8: 1..5, 2 boş, 8..18 (18 sütun); R7..R6: 1..18; R5..R1: 1..11
    r212_top: List[Optional[int]] = list(range(1, 6)) + [None, None] + list(range(8, 11)) + [None] + list(range(11, 16)) + [None, None]
    r212_8: List[Optional[int]] = list(range(1, 6)) + [None, None] + list(range(8, 19))
    blocks["212"] = {
        "id": "212",
        "name": "212 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 18,
        "rows": [
            {"row": 10, "cells": r212_top},
            {"row": 9, "cells": list(r212_top)},
            {"row": 8, "cells": r212_8},
            {"row": 7, "cells": _asc(18)},
            {"row": 6, "cells": _asc(18)},
        ] + [
            {"row": r, "cells": _pad_right(_asc(11), 18)}
            for r in range(5, 0, -1)
        ],
    }

    # 213 BLOK: R10: 1..4, 8 boş, 5..19 (27 sütun, 44'e tamamlanır)
    r213_10: List[Optional[int]] = _pad_right(list(range(1, 5)) + ([None] * 8) + list(range(5, 20)), 44)
    r213_counts = {9: 28, 8: 44, 7: 40, 6: 38, 5: 28, 4: 25, 3: 22, 2: 18, 1: 16}
    blocks["213"] = {
        "id": "213",
        "name": "213 BLOK",
        "zone": "north_upper",
        "court_side": "bottom",
        "cols": 44,
        "rows": [{"row": 10, "cells": r213_10}] + [
            {"row": r, "cells": _pad_right(_asc(r213_counts[r]), 44)}
            for r in range(9, 0, -1)
        ],
    }

    # ---------------------------------------------------------
    # BATI ÜST TRİBÜN (214, 215, 216) - Sıra 8..1 veya 10..1, Soldan Sağa 1..N
    # ---------------------------------------------------------
    r214_counts = {8: 22, 7: 22, 6: 25, 5: 18, 4: 18, 3: 18, 2: 18, 1: 18}
    blocks["214"] = {
        "id": "214",
        "name": "214 BLOK",
        "zone": "west_upper",
        "court_side": "right",
        "cols": 25,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r214_counts[r]), 25)}
            for r in range(8, 0, -1)
        ],
    }

    r215_counts = {8: 24, 7: 24, 6: 24, 5: 18, 4: 18, 3: 18, 2: 18, 1: 18}
    blocks["215"] = {
        "id": "215",
        "name": "215 BLOK",
        "zone": "west_upper",
        "court_side": "right",
        "cols": 24,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r215_counts[r]), 24)}
            for r in range(8, 0, -1)
        ],
    }

    r216_counts = {10: 23, 9: 30, 8: 45, 7: 41, 6: 38, 5: 29, 4: 26, 3: 23, 2: 20, 1: 17}
    blocks["216"] = {
        "id": "216",
        "name": "216 BLOK",
        "zone": "west_upper",
        "court_side": "right",
        "cols": 45,
        "rows": [
            {"row": r, "cells": _pad_right(_asc(r216_counts[r]), 45)}
            for r in range(10, 0, -1)
        ],
    }

    # Toplam kapasite hesapla
    for b_id, b_data in blocks.items():
        cap = 0
        valid_seats = set()
        for r_obj in b_data["rows"]:
            r_num = r_obj["row"]
            for s_num in r_obj["cells"]:
                if s_num is not None:
                    cap += 1
                    valid_seats.add(f"{r_num}-{s_num}")
        b_data["capacity"] = cap
        b_data["valid_seats"] = list(valid_seats)

    return blocks


BLOCKS_DB: Dict[str, Dict[str, Any]] = _build_all_blocks()


def get_block_layout(block_id: str, extra_seats: Optional[List[tuple]] = None) -> Dict[str, Any]:
    """
    Belirtilen blok için koltuk düzenini döndürür.
    Eğer PDF'lerde standart şema dışında ekstra bir koltuk varsa dinamik olarak ekler.
    """
    import copy
    if block_id in BLOCKS_DB:
        layout = copy.deepcopy(BLOCKS_DB[block_id])
    else:
        layout = {
            "id": block_id,
            "name": f"{block_id} BLOK",
            "zone": "other",
            "court_side": "top",
            "cols": 0,
            "rows": [],
            "capacity": 0,
            "valid_seats": [],
        }

    if extra_seats:
        existing = set(layout.get("valid_seats", []))
        missing = [(r, s) for (r, s) in extra_seats if f"{r}-{s}" not in existing]
        if missing:
            row_map = {r_obj["row"]: r_obj["cells"] for r_obj in layout["rows"]}
            for r, s in sorted(missing):
                if r not in row_map:
                    row_map[r] = []
                    layout["rows"].append({"row": r, "cells": row_map[r]})
                # Boş olmayan koltuklara ekle
                if s not in row_map[r]:
                    row_map[r].append(s)
            max_c = max((len(r_obj["cells"]) for r_obj in layout["rows"]), default=1)
            layout["cols"] = max_c
            for r_obj in layout["rows"]:
                while len(r_obj["cells"]) < max_c:
                    r_obj["cells"].append(None)

    return layout
