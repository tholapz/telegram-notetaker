from fastapi import Header, HTTPException, Request


async def get_request_id(request: Request) -> str:
    """Returns the request ID injected by RequestIDMiddleware."""
    return str(request.state.request_id)


async def verify_api_key(x_api_key: str = Header(...)) -> str:
    """Placeholder auth dependency — replace with real auth (OAuth2, JWT, etc.).

    To protect a route:
        @router.get("/secret", dependencies=[Depends(verify_api_key)])
    """
    if x_api_key != "dev-key":
        raise HTTPException(status_code=403, detail="Invalid API key")
    return x_api_key
