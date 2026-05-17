"""Unit tests for custom exception classes."""

from exceptions import (
    ActionExecutionError,
    PhoneNumberNotFoundError,
    TargetNotFoundError,
)


class TestTargetNotFoundError:
    def test_attributes_populated(self):
        exc = TargetNotFoundError(target_phone_number="+15551111111")
        assert exc.target_phone_number == "+15551111111"
        assert "+15551111111" in str(exc)


class TestActionExecutionError:
    def test_retryable_attributes(self):
        exc = ActionExecutionError(
            action_type="ad_a",
            phone_number="+15551111111",
            retryable=True,
            detail="timeout",
        )
        assert exc.retryable is True
        assert exc.detail == "timeout"
        assert "retryable" in str(exc)

    def test_non_retryable_attributes(self):
        exc = ActionExecutionError(
            action_type="ad_a",
            phone_number="+15551111111",
            retryable=False,
        )
        assert exc.retryable is False
        assert "non-retryable" in str(exc)

    def test_defaults(self):
        exc = ActionExecutionError(action_type="x", phone_number="y")
        assert exc.retryable is False
        assert exc.detail == ""


class TestPhoneNumberNotFoundError:
    def test_int_identifier(self):
        exc = PhoneNumberNotFoundError(identifier=42)
        assert exc.identifier == 42
        assert "42" in str(exc)

    def test_str_identifier(self):
        exc = PhoneNumberNotFoundError(identifier="+15550000000")
        assert "+15550000000" in str(exc)
