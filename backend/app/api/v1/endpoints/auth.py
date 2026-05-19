"""
app/api/v1/endpoints/auth.py — Phase AUTH endpoint surface.

Five routes:

    POST   /api/v1/auth/register        self-serve account creation
    POST   /api/v1/auth/login           username + password → cookie
    POST   /api/v1/auth/logout          revoke the active session
    GET    /api/v1/auth/me              who-am-I lookup (drives the
                                          frontend AuthContext hydrate)
    PATCH  /api/v1/auth/me              edit managed_client_ids / display_name

NO `/admins` ENDPOINTS
----------------------
Admins are NOT creatable via the API. The static `admins.json` file
+ startup-time `admin_sync.sync_admins()` is the SOLE creation path,
per the Phase AUTH requirement. Removing the endpoint entirely is
the cleanest structural guarantee — there's nothing to abuse.

COOKIE SEMANTICS
----------------
- Name:      `marketing_session` (single source — AuthService.COOKIE_NAME)
- HttpOnly:  yes (not readable from JS — frees ourselves from XSS theft)
- SameSite:  Lax (CSRF defense for same-origin SPA usage)
- Secure:    NOT set today (would break dev over HTTP; flip on once
              the deployment lands behind HTTPS — single setting)
- Expires:   none — session-cookie lifetime (browser-session-bound).
              Operators who close the browser get logged out; that
              matches the "lightweight guardrail" framing.
"""

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status

from app.api.deps import (
    get_auth_service,
    get_current_user,
    get_user_service,
    require_authenticated_user,
)
from exceptions import InvalidCredentialsError, UserAlreadyExistsError
from models.user import User
from schemas.auth import (
    LoginRequest,
    PatchMeRequest,
    RegisterRequest,
    UserResponse,
)
from services.auth import AuthService
from services.user import (
    UserService,
    display_name_of,
    managed_client_ids_of,
)


router = APIRouter()


# ---------------------------------------------------------------------------
# Internal — user → response shape
# ---------------------------------------------------------------------------


def _user_to_response(user: User) -> UserResponse:
    """
    Shape a User row for the wire. The structured-column accessors
    (`managed_client_ids_of`, `display_name_of`) live module-level
    in services.user — keeps the extraction logic out of the
    handlers.
    """
    return UserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        managed_client_ids=managed_client_ids_of(user),
        display_name=display_name_of(user),
        created_at=user.created_at,
    )


# ---------------------------------------------------------------------------
# POST /register
# ---------------------------------------------------------------------------


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Self-serve user registration",
    description=(
        "Creates a regular-user account and immediately issues a "
        "session cookie. Admin accounts are NOT creatable here — "
        "they live in `admins.json` and sync at startup."
        "\n\n"
        "**409** when the username is taken. **422** on shape errors "
        "(short username, missing managed_client_ids, etc.)."
    ),
)
def register(
    body: RegisterRequest,
    response: Response,
    user_service: UserService = Depends(get_user_service),
    auth: AuthService = Depends(get_auth_service),
) -> UserResponse:
    """
    Register + login in one round-trip. The new user is logged in
    immediately via the same Set-Cookie mechanism login uses — saves
    the operator a redundant second request.
    """
    try:
        user = user_service.register(
            username=body.username.strip(),
            password=body.password,
            managed_client_ids=body.managed_client_ids,
            display_name=body.display_name,
        )
    except UserAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # Issue a session for the freshly registered user — no separate
    # login call needed. We can't go through AuthService.login()
    # because that re-verifies the password; just mint the session
    # row directly.
    import secrets as _secrets
    from models.user import Session as SessionRow
    sess = SessionRow(
        token=_secrets.token_urlsafe(AuthService._TOKEN_BYTES),
        user_id=user.id,
    )
    auth.session.add(sess)
    auth.session.commit()
    auth.session.refresh(sess)
    _set_session_cookie(response, sess.token)

    return _user_to_response(user)


# ---------------------------------------------------------------------------
# POST /login
# ---------------------------------------------------------------------------


@router.post(
    "/login",
    response_model=UserResponse,
    summary="Login with username + password",
    description=(
        "Verifies credentials and issues a `marketing_session` cookie. "
        "**401** on any credential failure — the message is "
        "non-distinguishing (doesn't reveal 'username unknown' vs "
        "'wrong password') purely as operator-friendly courtesy."
    ),
)
def login(
    body: LoginRequest,
    response: Response,
    auth: AuthService = Depends(get_auth_service),
) -> UserResponse:
    try:
        user, sess = auth.login(
            username=body.username.strip(),
            password=body.password,
        )
    except InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    _set_session_cookie(response, sess.token)
    return _user_to_response(user)


# ---------------------------------------------------------------------------
# POST /logout
# ---------------------------------------------------------------------------


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke the active session and clear the cookie",
    description=(
        "Idempotent — calling with no cookie / a stale cookie still "
        "returns 204. The backend deletes the session row; the "
        "browser drops the cookie via the empty Set-Cookie header."
    ),
)
def logout(
    response: Response,
    marketing_session: str | None = Cookie(default=None, alias=AuthService.COOKIE_NAME),
    auth: AuthService = Depends(get_auth_service),
) -> None:
    if marketing_session:
        auth.logout(marketing_session)
    _clear_session_cookie(response)
    return None


# ---------------------------------------------------------------------------
# GET /me
# ---------------------------------------------------------------------------


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Return the currently authenticated user",
    description=(
        "401 when no valid session cookie is present. The frontend "
        "AuthContext calls this on mount to hydrate from an existing "
        "cookie (e.g., after a page reload)."
    ),
)
def me(
    user: User = Depends(require_authenticated_user),
) -> UserResponse:
    return _user_to_response(user)


# ---------------------------------------------------------------------------
# PATCH /me
# ---------------------------------------------------------------------------


@router.patch(
    "/me",
    response_model=UserResponse,
    summary="Update the current user's mutable fields",
    description=(
        "Partial update — only fields present in the body are written. "
        "Today's mutable fields: `managed_client_ids` and "
        "`display_name`. Username / password / role are NOT exposed "
        "here (see schemas/auth.py PatchMeRequest docstring for why)."
        "\n\n"
        "**401** when not logged in. **422** for empty "
        "managed_client_ids."
    ),
)
def patch_me(
    body: PatchMeRequest,
    user: User = Depends(require_authenticated_user),
    user_service: UserService = Depends(get_user_service),
) -> UserResponse:
    if body.managed_client_ids is not None:
        try:
            user = user_service.update_managed_client_ids(
                user.id, body.managed_client_ids,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
    if body.display_name is not None:
        user = user_service.update_display_name(user.id, body.display_name)
    return _user_to_response(user)


# ---------------------------------------------------------------------------
# Cookie helpers — single source of truth for Set-Cookie semantics
# ---------------------------------------------------------------------------


def _set_session_cookie(response: Response, token: str) -> None:
    """
    Set-Cookie with the Phase AUTH defaults: HttpOnly + SameSite=Lax,
    no Secure flag (would break HTTP dev), no Domain (same-origin
    only), no Max-Age (session-cookie lifetime).
    """
    response.set_cookie(
        key=AuthService.COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,    # flip to True once HTTPS lands in deployment
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    """Same name + path, expiring immediately. Idempotent."""
    response.delete_cookie(
        key=AuthService.COOKIE_NAME,
        path="/",
    )
