"""BallonsTranslator'ı bu proje için yapılandırır (Japonca -> Türkçe, okunabilir yazı boyutu).

Kullanım:
    python setup_ballons.py [BallonsTranslator_klasörü]

Belirtilmezse MangaReader'ın bir üst klasöründeki BallonsTranslator kullanılır.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BT = os.path.normpath(os.path.join(HERE, "..", "BallonsTranslator"))


def patch_file(path, replacements):
    if not os.path.isfile(path):
        print(f"ATLA (dosya yok): {path}")
        return
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    changed = False
    for old, new in replacements:
        if old in text:
            text = text.replace(old, new)
            changed = True
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"YAMANDI: {path}")
    else:
        print(f"ZATEN AYNI: {path}")


def main():
    bt = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BT
    bt = os.path.abspath(bt)
    print("BallonsTranslator:", bt)

    bubble = os.path.join(bt, "ballontranslator", "ui", "text_engine", "bubble_layout.py")
    manager = os.path.join(bt, "ballontranslator", "ui", "text_engine", "editing", "manager.py")

    patch_file(bubble, [
        ("minimum = min(9., maximum)", "minimum = min(READABILITY_FLOOR_PX, maximum)"),
        ("actual < 9 - .1", "actual < READABILITY_FLOOR_PX - .1"),
        ("READABILITY_FLOOR_PX = 14.0", "READABILITY_FLOOR_PX = 18.0"),
    ])
    patch_file(manager, [
        ("downscale_constraint = 0.6", "downscale_constraint = 0.9"),
        ("resize_ratio = min(max(resize_ratio, 0.6), 1)",
         "resize_ratio = min(max(resize_ratio, 0.9), 1)"),
        ("downscale_constraint = 0.8", "downscale_constraint = 0.9"),
        ("resize_ratio = min(max(resize_ratio, 0.8), 1)",
         "resize_ratio = min(max(resize_ratio, 0.9), 1)"),
        ("from ..bubble_layout import fit_text_in_shape",
         "from ..bubble_layout import fit_text_in_shape\n\nMIN_FONT_PT = 18.0"),
        ("new_font_size = blk_font.pointSizeF() * resize_ratio",
         "new_font_size = max(blk_font.pointSizeF() * resize_ratio, MIN_FONT_PT)"),
        ("new_font_size = blkitem.font().pointSizeF() * resize_ratio",
         "new_font_size = max(blkitem.font().pointSizeF() * resize_ratio, MIN_FONT_PT)"),
        ("max_enlarge_ratio = 2.5", "max_enlarge_ratio = 4.0"),
        ("max_enlarge_ratio = 3\n", "max_enlarge_ratio = 5.0\n"),
        (") * 1.5, max_enlarge_ratio)", ") * 2.0, max_enlarge_ratio)"),
    ])

    # READABILITY_FLOOR_PX sabiti yoksa ekle.
    if os.path.isfile(bubble):
        with open(bubble, "r", encoding="utf-8") as f:
            text = f.read()
        if "READABILITY_FLOOR_PX" not in text:
            marker = "from ballontranslator.utils.bubble_shape import BubbleShape, bubble_path\n"
            if marker in text:
                text = text.replace(marker, marker + "\nREADABILITY_FLOOR_PX = 14.0\n", 1)
                with open(bubble, "w", encoding="utf-8") as f:
                    f.write(text)
                print("SABIT EKLENDI: READABILITY_FLOOR_PX = 14.0")

    cfg_dir = os.path.join(bt, "config")
    os.makedirs(cfg_dir, exist_ok=True)
    cfg_path = os.path.join(cfg_dir, "config.json")
    cfg = {
        "module": {
            "textdetector": "ctd",
            "ocr": "mit48px",
            "inpainter": "lama_large_512px",
            "translator": "google",
            "enable_detect": True,
            "enable_ocr": True,
            "enable_translate": True,
            "enable_inpaint": True,
            "translate_source": "日本語",
            "translate_target": "Türk dili",
            "ocr_llm_sort_reading_order": True,
            "check_need_inpaint": False,
            "empty_runcache": True,
        },
        "global_fontformat": {
            "font_size": 24,
            "letter_spacing": 1.0,
            "line_spacing": 1.1,
            "frgb": [255, 255, 255],
            "srgb": [0, 0, 0],
            "stroke_width": 1.5,
        },
        "let_fntsize_flag": 0,
        "let_autolayout_flag": True,
    }
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("CONFIG YAZILDI:", cfg_path)
    print("Tamamlandı.")


if __name__ == "__main__":
    main()