package edu.cloudnative.booking.api;

import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.List;

@RestControllerAdvice
public class ApiErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiErrorHandler.class);

    public record FieldIssue(String field, String message) {}
    public record ErrorBody(String code, String message, List<FieldIssue> details) {}
    public record ErrorEnvelope(ErrorBody error) {}

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ErrorEnvelope> business(ApiException exception) {
        return response(exception.status(), exception.code(), exception.getMessage(), List.of());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorEnvelope> validation(MethodArgumentNotValidException exception) {
        var details = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> new FieldIssue(error.getField(), error.getDefaultMessage())).toList();
        return response(HttpStatus.BAD_REQUEST, "INVALID_ARGUMENT", "请求字段不符合要求", details);
    }

    @ExceptionHandler({ConstraintViolationException.class, MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class})
    ResponseEntity<ErrorEnvelope> malformed(Exception exception) {
        return response(HttpStatus.BAD_REQUEST, "INVALID_ARGUMENT", "请求参数、JSON 格式或字段类型不正确", List.of());
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ErrorEnvelope> database(DataAccessException exception) {
        log.error("Database operation failed", exception);
        return response(HttpStatus.SERVICE_UNAVAILABLE, "DATABASE_UNAVAILABLE", "数据库暂时不可用，请稍后重试", List.of());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorEnvelope> unexpected(Exception exception) {
        if (exception instanceof ErrorResponse error && error.getStatusCode().is4xxClientError()) {
            return response(error.getStatusCode(), "HTTP_ERROR", "请求路径、方法或媒体类型不受支持", List.of());
        }
        log.error("Unexpected request failure", exception);
        return response(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "服务器内部错误", List.of());
    }

    private static ResponseEntity<ErrorEnvelope> response(HttpStatusCode status, String code,
                                                          String message, List<FieldIssue> details) {
        return ResponseEntity.status(status).body(new ErrorEnvelope(new ErrorBody(code, message, details)));
    }
}
