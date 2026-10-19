package edu.cloudnative.booking;

import edu.cloudnative.booking.api.ApiErrorHandler;
import edu.cloudnative.booking.api.BookingController;
import edu.cloudnative.booking.service.BookingService;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApiErrorHandlerTest {
    @Test
    void databaseFailureIsSanitized() throws Exception {
        BookingService service = mock(BookingService.class);
        when(service.getVenue(1)).thenThrow(new DataAccessResourceFailureException("internal JDBC connection details"));
        MockMvcBuilders.standaloneSetup(new BookingController(service)).setControllerAdvice(new ApiErrorHandler())
                .build().perform(get("/api/venues/1"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("DATABASE_UNAVAILABLE"))
                .andExpect(content().string(not(containsString("JDBC"))));
    }

    @Test
    void unexpectedFailureDoesNotExposeStackOrMessage() throws Exception {
        BookingService service = mock(BookingService.class);
        when(service.getVenue(1)).thenThrow(new IllegalStateException("private implementation details"));
        MockMvcBuilders.standaloneSetup(new BookingController(service)).setControllerAdvice(new ApiErrorHandler())
                .build().perform(get("/api/venues/1"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"))
                .andExpect(content().string(not(containsString("private implementation details"))))
                .andExpect(content().string(not(containsString("IllegalStateException"))));
    }
}
