#!/bin/bash
# Самотест wireloom-render.py: обе рамки (browser/mobile) реально рендерят
# через установленный рантайм, сломанный блок падает с понятной причиной,
# а не пустой страницей. Требует npm install в scripts/wireloom-runtime/ —
# без него оба «good_*» теста ожидаемо проваливаются с той же диагностикой,
# что увидит вызывающий bft-html-export.py на живом документе.
# Запуск из корня репозитория: bash skills/bft-wireframing/scripts/test-wireloom-render.sh
set -u

SCRIPT="skills/bft-wireframing/scripts/wireloom-render.py"
FIX="skills/bft-wireframing/scripts/fixtures"
fails=0

check_svg() {
  local device="$1" fixture="$2" min_frames="$3"
  local out err rc
  out="$(python3 "$SCRIPT" --device "$device" < "$FIX/$fixture" 2>/tmp/wl_err.$$)"
  rc=$?
  err="$(cat /tmp/wl_err.$$)"; rm -f /tmp/wl_err.$$
  if [ "$rc" -ne 0 ]; then
    echo "FAIL  $fixture ($device): код $rc, stderr: $err"
    fails=$((fails + 1))
    return
  fi
  if [[ "$out" != '<svg'* ]]; then
    echo "FAIL  $fixture ($device): вывод не начинается с <svg"
    fails=$((fails + 1))
    return
  fi
  local svg_tags frames
  svg_tags=$(grep -o "<svg " <<<"$out" | wc -l)
  # На кадр — два вложенных <svg>: обёртка compose() + обёртка рамки
  # (browser/mobile); плюс один корневой холст на весь документ.
  frames=$(( (svg_tags - 1) / 2 ))
  if [ "$frames" -lt "$min_frames" ]; then
    echo "FAIL  $fixture ($device): кадров меньше ожидаемого ($frames при ожидаемых $min_frames)"
    fails=$((fails + 1))
    return
  fi
  echo "ok    $fixture ($device): SVG собран, кадров $frames"
}

check_svg browser good_browser.txt 2
check_svg mobile good_mobile.txt 1

# Мобильная рамка — реальный телефонный фрейм (вырез + полоса home-индикатора),
# не браузерный chrome по умолчанию для другого device.
mobile_out="$(python3 "$SCRIPT" --device mobile < "$FIX/good_mobile.txt" 2>/dev/null)"
if grep -q 'rx="4.5" fill="#1f2328"' <<<"$mobile_out"; then
  echo "ok    mobile: вырез камеры нарисован (не браузерный chrome)"
else
  echo "FAIL  mobile: не нашли декор телефонной рамки — похоже, ушёл browser chrome"
  fails=$((fails + 1))
fi

# Сломанный кадр — понятная причина в stderr и ненулевой код, а не пустой
# stdout: страница должна получить [УТОЧНИТЬ] с текстом, а не тишину.
broken_err="$(python3 "$SCRIPT" --device browser < "$FIX/broken_no_separator.txt" 2>&1 >/dev/null)"
broken_rc=$?
if [ "$broken_rc" -ne 0 ] && grep -q "разделител" <<<"$broken_err"; then
  echo "ok    сломанный кадр (нет \"---\") падает с понятной причиной"
else
  echo "FAIL  сломанный кадр: код $broken_rc, stderr: $broken_err"
  fails=$((fails + 1))
fi

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
