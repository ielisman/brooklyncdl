import re
from pathlib import Path

path = Path(r'c:/development/brooklyncdl/index.html')
try:
    text = path.read_text(encoding='utf-8')
except UnicodeDecodeError:
    text = path.read_text(encoding='utf-8', errors='ignore')
    print('Note: Had to ignore some encoding errors')

print(f'Original file: {len(text)} characters, {len(text.splitlines())} lines')

# 1. Remove quizRegistry
quiz_start = text.find('const quizRegistry = {')
if quiz_start == -1:
    raise SystemExit('ERROR: quizRegistry not found')

# Match braces to find end
brace_count = 0
i = text.find('{', quiz_start)
while i < len(text):
    if text[i] == '{':
        brace_count += 1
    elif text[i] == '}':
        brace_count -= 1
        if brace_count == 0:
            break
    i += 1

quiz_end = i + 1
if quiz_end < len(text) and text[quiz_end] == ';':
    quiz_end += 1
while quiz_end < len(text) and text[quiz_end] in '\r\n':
    quiz_end += 1

print(f'✓ Found quizRegistry: lines ~{text[:quiz_start].count(chr(10))+1} to ~{text[:quiz_end].count(chr(10))+1}')

# 2. Remove sectionScores
section_start = text.find('let sectionScores = {', quiz_end)
if section_start == -1:
    raise SystemExit('ERROR: sectionScores not found')

brace_count = 0
i = text.find('{', section_start)
while i < len(text):
    if text[i] == '{':
        brace_count += 1
    elif text[i] == '}':
        brace_count -= 1
        if brace_count == 0:
            break
    i += 1

section_end = i + 1
if section_end < len(text) and text[section_end] == ';':
    section_end += 1
while section_end < len(text) and text[section_end] in '\r\n':
    section_end += 1

print(f'✓ Found sectionScores: lines ~{text[:section_start].count(chr(10))+1} to ~{text[:section_end].count(chr(10))+1}')

# 3. Remove getContentForSection function
func_match = re.search(r'function getContentForSection\(id\) \{', text[section_end:])
if not func_match:
    raise SystemExit('ERROR: getContentForSection not found')

func_start = section_end + func_match.start()

# Find function end by matching braces
brace_count = 0
i = section_end + func_match.end() - 1
while i < len(text):
    if text[i] == '{':
        brace_count += 1
    elif text[i] == '}':
        brace_count -= 1
        if brace_count == 0:
            break
    i += 1

func_end = i + 1
while func_end < len(text) and text[func_end] in '\r\n ':
    func_end += 1

print(f'✓ Found getContentForSection: lines ~{text[:func_start].count(chr(10))+1} to ~{text[:func_end].count(chr(10))+1}')

# Build new content with comments
indent = '    '
replacement = f'{indent}// Legacy quizRegistry removed - all quiz content now loads from database via server API\n'
replacement += f'{indent}// Legacy sectionScores removed - progress now tracked in database\n'
replacement += f'{indent}// Legacy getContentForSection removed - content now loaded via showDatabaseContent\n\n{indent}'

new_text = text[:quiz_start] + replacement + text[func_end:]

print(f'\nNew file: {len(new_text)} characters, {len(new_text.splitlines())} lines')
print(f'Removed: {len(text) - len(new_text)} characters')

# Write back
path.write_text(new_text, encoding='utf-8')
print('\n✅ Successfully removed all legacy client-side code!')
