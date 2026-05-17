<?php
// Token exchange proxy for Deriv OAuth 2.0 PKCE flow
// Place this file in your cPanel public_html directory
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://mytrades.beexelgraphics.com');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['code']) || !isset($input['code_verifier']) || !isset($input['client_id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required fields: code, code_verifier, client_id']);
    exit;
}

$postData = http_build_query([
    'grant_type' => 'authorization_code',
    'client_id' => $input['client_id'],
    'code' => $input['code'],
    'redirect_uri' => $input['redirect_uri'] ?? 'https://mytrades.beexelgraphics.com/',
    'code_verifier' => $input['code_verifier']
]);

$ch = curl_init('https://auth.deriv.com/oauth2/token');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $postData,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
    CURLOPT_TIMEOUT => 15
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    echo json_encode(['error' => 'Token exchange request failed: ' . $error]);
    exit;
}

http_response_code($httpCode);
echo $response;
