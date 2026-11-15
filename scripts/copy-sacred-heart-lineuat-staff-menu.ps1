param([string]$InspectMenuId)

$ErrorActionPreference = 'Stop'

$sourceId = 'richmenu-daa57224afb5a808e8d1ab909ba620a0'
$targetOrigin = 'https://icy-ocean-0a2602100-lineuat.eastasia.6.azurestaticapps.net'
$apiRoot = 'https://api.line.me/v2/bot'
$dataRoot = 'https://api-data.line.me/v2/bot'
$expectedTargets = @('staff_today_courses', 'staff_activity_calendar', 'staff_announcements', 'staff_attendance', 'staff_todos', 'staff_portal')
$chatTargets = @('staff_today_courses', 'staff_activity_calendar', 'staff_announcements')
$staffCommandPrefix = '#' + [char]0x5E79 + [char]0x90E8

$secureToken = Read-Host 'LINE Messaging API Access Token for @154sfvwp' -AsSecureString
if ($secureToken.Length -eq 0) { throw 'No token was entered.' }
$headers = @{ Authorization = 'Bearer ' + ([Net.NetworkCredential]::new('', $secureToken).Password.Trim()) }

function Read-LineJson($uri) {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers
    [Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray()) | ConvertFrom-Json
}

function Get-MenuActionKeys($areas) {
    $areas | ForEach-Object {
        "$($_.bounds.y)|$($_.bounds.x)|$($_.action.type)|$($_.action.text)|$($_.action.uri)"
    } | Sort-Object
}

try {
    $bot = Read-LineJson "$apiRoot/info"
    if ($bot.basicId -ne '@154sfvwp') { throw 'This token belongs to a different official account. No changes were made.' }
    if ($InspectMenuId) {
        if ($InspectMenuId -notmatch '^richmenu-[0-9a-f]{32}$') { throw 'Invalid rich menu ID.' }
        $menu = Read-LineJson "$apiRoot/richmenu/$InspectMenuId"
        $menu.areas | Sort-Object { $_.bounds.y }, { $_.bounds.x } | ForEach-Object { $_.action } | Format-List label, type, text, uri
        return
    }

    $source = Read-LineJson "$apiRoot/richmenu/$sourceId"
    if ($source.areas.Count -ne 6) { throw 'The source menu does not have six buttons.' }
    $areas = @(foreach ($area in $source.areas) {
        $uri = [Uri]$area.action.uri
        $target = [regex]::Match($uri.Query, '(?:^\?|&)line_menu=([a-z_]+)(?:&|$)').Groups[1].Value
        if ($area.action.type -ne 'uri' -or $target -notin $expectedTargets) { throw 'An unexpected source button was found.' }
        $action = if ($target -in $chatTargets) {
            @{type = 'message'; label = $area.action.label; text = $staffCommandPrefix + $area.action.label}
        } else {
            @{type = 'uri'; label = $area.action.label; uri = "$targetOrigin/?line_menu=$target&schoolId=sacred-heart&openExternalBrowser=1"}
        }
        @{bounds = $area.bounds; action = $action}
    })
    $actionKeys = @(Get-MenuActionKeys $areas)
    $destinations = @($areas | ForEach-Object { "$($_.action.type)|$($_.action.text)|$($_.action.uri)" } | Sort-Object -Unique)
    if ($destinations.Count -ne 6) { throw 'One or more staff menu destinations are missing.' }

    $menuName = $source.name + ' (lineuat chat)'
    $existingMenus = (Read-LineJson "$apiRoot/richmenu/list").richmenus
    foreach ($menu in $existingMenus) {
        if ($menu.name -ne $menuName -or $menu.areas.Count -ne 6) { continue }
        $existingKeys = @(Get-MenuActionKeys $menu.areas)
        if (Compare-Object $actionKeys $existingKeys -SyncWindow 0) { continue }
        try {
            $null = Invoke-WebRequest -UseBasicParsing -Uri "$dataRoot/richmenu/$($menu.richMenuId)/content" -Headers $headers
            Write-Output $menu.richMenuId
            return
        } catch {
            if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) { throw }
        }
    }

    $image = Invoke-WebRequest -UseBasicParsing -Uri "$dataRoot/richmenu/$sourceId/content" -Headers $headers
    $mimeType = ([string]$image.Headers['Content-Type']).Split(';')[0]
    if ($mimeType -notin @('image/png', 'image/jpeg')) { throw 'The source image is not PNG or JPEG.' }
    $menuBody = @{
        size = $source.size; selected = $source.selected; name = $menuName
        chatBarText = $source.chatBarText; areas = $areas
    } | ConvertTo-Json -Depth 7 -Compress
    $new = Invoke-RestMethod -Method Post -Uri "$apiRoot/richmenu" -Headers $headers `
        -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($menuBody))
    try {
        $saved = Read-LineJson "$apiRoot/richmenu/$($new.richMenuId)"
        if ($saved.areas.Count -ne 6 -or (Compare-Object $actionKeys @(Get-MenuActionKeys $saved.areas) -SyncWindow 0)) {
            throw 'LINE saved a different button layout. The incomplete menu copy will be removed.'
        }
        $null = Invoke-RestMethod -Method Post -Uri "$dataRoot/richmenu/$($new.richMenuId)/content" `
            -Headers $headers -ContentType $mimeType -Body ($image.RawContentStream.ToArray())
    } catch {
        $uploadError = $_
        try { $null = Invoke-RestMethod -Method Delete -Uri "$apiRoot/richmenu/$($new.richMenuId)" -Headers $headers } catch {
            Write-Warning "Image upload failed and the incomplete copy could not be removed: $($new.richMenuId)"
        }
        throw $uploadError
    }
    Write-Output $new.richMenuId
} finally {
    Remove-Variable headers, secureToken -ErrorAction SilentlyContinue
}
