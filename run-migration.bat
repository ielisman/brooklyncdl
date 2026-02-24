@echo off
REM Admin Dashboard Migration Script
REM This script applies the database migration for the Admin Dashboard feature

echo ============================================
echo Brooklyn CDL - Admin Dashboard Migration
echo ============================================
echo.

REM Get database connection details from .env or use defaults
set DB_HOST=localhost
set DB_PORT=1433
set DB_NAME=brooklyncdl
set DB_USER=sa

echo Database: %DB_NAME%
echo Host: %DB_HOST%
echo Port: %DB_PORT%
echo.

echo Running migration...
echo.

REM For PostgreSQL (if you're using PostgreSQL)
REM psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f database\migration-admin-dashboard.sql

REM For SQL Server (using sqlcmd)
sqlcmd -S %DB_HOST%,%DB_PORT% -d %DB_NAME% -U %DB_USER% -i database\migration-admin-dashboard.sql

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo ✅ Migration completed successfully!
    echo ============================================
    echo.
    echo Next steps:
    echo 1. Restart the server: docker restart brooklyncdl-app
    echo 2. Login as an admin user
    echo 3. Navigate to admin-dashboard.html
    echo.
) else (
    echo.
    echo ============================================
    echo ❌ Migration failed!
    echo ============================================
    echo.
    echo Please check the error messages above.
    echo.
)

pause
